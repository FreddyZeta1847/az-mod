/*
 * actions.ts — what Raccolta does, as plain `function name($, ...)` declarations (the
 * engine refuses $ passed to object methods or arrow functions): boot at session start,
 * Scan, Update, refresh one resource, the month's costs, the week's activities, the rule changes behind the pane's button keys,
 * the «+ Aggiungi» search, and the 30 s timer of the automatic Update.
 * No action ever throws to its caller: the outcome lands in state (busy, health, cache,
 * rules, suggestions, found). Every rules change goes through saveRules (backup first).
 */
import { atom, read, update as change } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { activityArgs, activityDue, activityLoop, parseActivity } from './activity'
import { currentSubscription, runAz } from './az'
import { costBody, costDue, costLoop, costUrl, parseCost } from './cost'
import type { AzRun } from './az'
import { graphRows, inScope, linkRegistries, markGone, readOne, readProject } from './graph'
import { resolveProject } from './project'
import { cacheForSubscription, keepNewerReads, loop, noteError, noteSuccess, resume, shouldRefresh, intervalFor, TICK_MS } from './refresh'
import { addGroupTo, dismissIn, excludeIn, includeIn, isGroupId, rankSearch, removeGroupFrom, restoreIn } from './rules-ops'
import { projectFiles, scanCandidates } from './scan'
import type { ScanRow } from './scan'
import { dataDir, emptyRules, loadCache, loadRules, readSavedRules, resetRules as writeReset, saveCache, saveRules, takeLease } from './store'
import { groupIdOf, PANE, parseKey } from '../contract'
import type { PaneAction } from '../contract'
import type { AzBusy, AzCache, AzCard, AzError, AzEvent, AzHealth, AzId, AzRules, AzSuggestion } from '../../types'

// The engine accepts only atoms declared in the file that reads them: exact copies of contract.ts.
const projectAtom = atom({ plugin: 'az-mod', key: 'project' } as const, null, { shape: 'project-1' })
const rulesAtom = atom({ plugin: 'az-mod', key: 'rules' } as const, null, { shape: 'rules-1' })
const cacheAtom = atom({ plugin: 'az-mod', key: 'cache' } as const, null, { shape: 'cache-1' })
const eventsAtom = atom({ plugin: 'az-mod', key: 'events' } as const, [], { shape: 'events-1' })
const suggestionsAtom = atom({ plugin: 'az-mod', key: 'suggestions' } as const, [], { shape: 'suggestions-1' })
const autoAddedAtom = atom({ plugin: 'az-mod', key: 'autoAdded' } as const, null, { shape: 'autoAdded-1' })
const busyAtom = atom({ plugin: 'az-mod', key: 'busy' } as const,
  { scan: false, update: false, cost: false, ids: [] }, { shape: 'busy-1' })
const healthAtom = atom({ plugin: 'az-mod', key: 'health' } as const,
  { az: 'ok', isLeaseHolder: false, nextAutoAt: null, rulesMode: 'ok' }, { shape: 'health-1' })
const foundAtom = atom({ plugin: 'az-mod', key: 'found' } as const, [], { shape: 'found-1' })
const uiAtom = atom({ plugin: 'az-mod', key: 'ui' } as const,
  { lastInputAt: 0, openCard: null, closed: [], showAuto: false, showHidden: false, isAdding: false }, { shape: 'ui-1' })

/**
 * This module load's memory: the last `az resource list` read (search and hook proposals rank
 * it), the read in flight (one at a time), and whether an Update was asked during a running one.
 */
type Failed = Extract<AzRun, { ok: false }>
const mem = { lastList: [] as ScanRow[], listing: undefined as Promise<Failed | null> | undefined, again: false }

const LIST_QUERY = '[].{id:id,name:name,type:type,resourceGroup:resourceGroup}'
const ENRICH_QUERY = "resources | where type in~ ('microsoft.web/staticsites', 'microsoft.app/containerapps') "
  + '| project id = tolower(id), repositoryUrl = tostring(properties.repositoryUrl), image = tostring(properties.template.containers[0].image)'

// ---------------------------------------------------------------- state helpers

async function setBusy($: EngineInterface, patch: Partial<AzBusy>): Promise<void> {
  await change($, busyAtom, b => ({ ...b, ...patch }))
}

async function setHealth($: EngineInterface, patch: Partial<AzHealth>): Promise<void> {
  await change($, healthAtom, h => ({ ...h, ...patch }))
}

async function setBusyId($: EngineInterface, id: AzId, isBusy: boolean): Promise<void> {
  await change($, busyAtom, b => ({ ...b, ids: isBusy ? [...b.ids, id] : b.ids.filter(x => x !== id) }))
}

/**
 * Writes a whole photo (an Update, one card, a group taken out) built from a copy read earlier:
 * costs and activities that landed meanwhile are newer than that copy and are kept.
 */
async function setCache($: EngineInterface, cache: AzCache): Promise<void> {
  await change($, cacheAtom, current => keepNewerReads(cache, current))
  const latest = await read($, cacheAtom)
  if (latest !== null) await saveCache($, latest)
}

/**
 * Changes one part of the photo as it is now (costs and activities are read at the same time:
 * a copy taken before the other's write would undo it), then saves the newest photo. Nothing
 * changes when the photo now belongs to another subscription (az account set during the read).
 */
async function patchCache($: EngineInterface, subId: string, patch: (c: AzCache) => AzCache): Promise<void> {
  await change($, cacheAtom, c => (c === null || c.subscription.id !== subId ? c : patch(c)))
  const latest = await read($, cacheAtom)
  if (latest !== null) await saveCache($, latest)
}

/** Every page of a Cost Management answer (it pages with `nextLink`), rows joined under the first page's columns. */
async function costPages($: EngineInterface, url: string, bodyPath: string, maxPages = 10): Promise<AzRun> {
  const rows: unknown[] = []
  let first: { properties?: { columns?: unknown; rows?: unknown[]; nextLink?: unknown } } | undefined
  let next: string | undefined = url
  for (let page = 0; page < maxPages && next !== undefined; page++) {
    const r = await runAz($, ['rest', '--method', 'post', '--url', next, '--body', `@${bodyPath}`])
    if (!r.ok) return r
    const answer = r.json as typeof first
    first ??= answer
    rows.push(...(Array.isArray(answer?.properties?.rows) ? answer.properties.rows : []))
    const link = answer?.properties?.nextLink
    next = typeof link === 'string' && link.startsWith('https://management.azure.com/') ? link : undefined
  }
  return { ok: true, json: { properties: { columns: first?.properties?.columns ?? [], rows } } }
}

/** Saves and publishes new rules; refused (and nothing changes) in read-only or broken mode. */
async function setRules($: EngineInterface, rules: AzRules): Promise<boolean> {
  const project = await read($, projectAtom)
  const health = await read($, healthAtom)
  if (project === null || !(await saveRules($, project.key, rules, health.rulesMode))) return false
  await change($, rulesAtom, () => rules)
  return true
}

/**
 * The rules as saved now: the file first, since another session on the same project may have
 * changed it since boot (its rules and its mode are published here too), else the ones in state.
 */
async function savedRules($: EngineInterface): Promise<AzRules | null> {
  const project = await read($, projectAtom)
  if (project === null) return null
  const mine = await read($, rulesAtom)
  const disk = await readSavedRules($, project.key)
  // no file, or one half-written right now: keep what is in state
  if (disk.rules === null) return mine
  if ((await read($, healthAtom)).rulesMode !== disk.mode) await setHealth($, { rulesMode: disk.mode })
  const rules = disk.rules
  if (JSON.stringify(rules) !== JSON.stringify(mine)) await change($, rulesAtom, () => rules)
  return rules
}

/** The rules to change: the saved ones, or empty ones when the project has none yet. */
async function currentRules($: EngineInterface): Promise<AzRules | null> {
  const project = await read($, projectAtom)
  if (project === null) return null
  return (await savedRules($)) ?? emptyRules(project, await $.clock.now())
}

async function noteFailure($: EngineInterface, run: Failed): Promise<void> {
  const az = run.missing === true ? 'missing' : run.error.code === 'login' ? 'login' : undefined
  // the error also goes in health: with no photo yet, the pane has nowhere else to show it
  await setHealth($, az === undefined ? { error: run.error } : { az, error: run.error })
  noteError(run.error, await $.clock.now())
  const cache = await read($, cacheAtom)
  if (cache !== null) await change($, cacheAtom, () => ({ ...cache, errors: { ...cache.errors, state: run.error } }))
}

async function dropSuggestion($: EngineInterface, id: string): Promise<void> {
  await change($, suggestionsAtom, l => l.filter(s => s.id !== id))
  await change($, foundAtom, l => l.filter(s => s.id !== id))
}

/** Adds proposals not already shown, replacing those of the same origins when asked. */
async function offer($: EngineInterface, list: AzSuggestion[], replaceOrigins: AzSuggestion['origin'][] = []): Promise<void> {
  await change($, suggestionsAtom, old => {
    const kept = old.filter(s => !replaceOrigins.includes(s.origin))
    return [...kept, ...list.filter(s => !kept.some(k => k.id === s.id))]
  })
}

// ---------------------------------------------------------------- reads

/**
 * Reads the subscription's resource list, one read at a time (keystrokes in the search share it).
 * `quiet`: a failure is not noted (no backoff, no banner); each caller decides for itself.
 */
async function readList($: EngineInterface, quiet = false): Promise<boolean> {
  mem.listing ??= listOnce($).finally(() => { mem.listing = undefined })
  const failed = await mem.listing
  if (failed !== null && !quiet) await noteFailure($, failed)
  return failed === null
}

async function listOnce($: EngineInterface): Promise<Failed | null> {
  const r = await runAz($, ['resource', 'list', '--query', LIST_QUERY], 120_000)
  if (!r.ok) return r
  const rows = (Array.isArray(r.json) ? r.json : []) as ScanRow[]
  mem.lastList = rows.filter(x => typeof x?.id === 'string' && typeof x.name === 'string')
  return null
}

/** Adds the static sites' repository and the container images (one Resource Graph page; failure only loses those hints). */
async function enrichList($: EngineInterface, subId: string): Promise<void> {
  const r = await graphRows($, ENRICH_QUERY, subId, 1)
  if (!r.ok) return
  const extra = new Map((r.rows as unknown as ScanRow[]).map(x => [String(x.id).toLowerCase(), x]))
  mem.lastList = mem.lastList.map(x => ({ ...x, ...pickHints(extra.get(x.id.toLowerCase())) }))
}

const pickHints = (x: ScanRow | undefined): Partial<ScanRow> =>
  x === undefined ? {} : { repositoryUrl: x.repositoryUrl ?? null, image: x.image ?? null }

/** Proposals for resources a card uses that are not in the project (environment, plan, identity…). */
const relatedOf = (cache: AzCache, rules: AzRules): AzSuggestion[] => {
  const ids = new Set(Object.values(cache.resources).flatMap(c => c.uses))
  return [...ids].filter(id => !(id in cache.resources) && !(id in rules.dismissed) && !(id in rules.excludes))
    .map((id): AzSuggestion => ({ id, kind: 'resource', origin: 'related', reason: 'used-by', name: id.slice(id.lastIndexOf('/') + 1) }))
}

// ---------------------------------------------------------------- actions

/**
 * Update: re-reads every group and include of the project from Resource Graph. Never proposes,
 * but related resources. No rules yet (the first Scan failed) → it scans again instead. Asked
 * while one runs → it runs once more right after. The photo is built with the rules as they are
 * when Azure answers, so a group added or removed meanwhile is never undone.
 */
async function updateProject($: EngineInterface): Promise<void> {
  const project = await read($, projectAtom)
  if (project === null) return
  const busy = await read($, busyAtom)
  if ((await read($, rulesAtom)) === null) {
    if (!busy.scan && (await read($, healthAtom)).rulesMode === 'ok') await scanProject($, true)
    return
  }
  if (busy.update) {
    mem.again = true
    return
  }
  await setBusy($, { update: true })
  try {
    await readAndPublish($, project.key)
  } catch {
    // shortcut: an unexpected failure only ends this Update; the next tick or press tries again
  } finally {
    await setBusy($, { update: false })
    if (mem.again) {
      mem.again = false
      void updateProject($)
    }
  }
}

async function readAndPublish($: EngineInterface, key: string): Promise<void> {
  const asked = await read($, rulesAtom)
  if (asked === null) return
  const sub = await currentSubscription($)
  if (!sub.ok) return await noteFailure($, sub)
  const r = await readProject($, asked, sub.sub.id)
  if (!r.ok) return await noteFailure($, r)
  // the rules and the photo as they are now: a press during the read must not be undone
  const rules = (await read($, rulesAtom)) ?? asked
  if (rules.updatedAt !== asked.updatedAt) mem.again = true
  const cache = cacheForSubscription(await read($, cacheAtom), sub.sub, key)
  const now = await $.clock.now()
  const cards = Object.fromEntries(Object.entries(r.cards).filter(([, c]) => inScope(c, rules)))
  const { state: _old, ...errors } = cache.errors
  const next: AzCache = {
    ...cache, errors, stateAt: now, resources: markGone(cache.resources, cards, now, rules),
    groups: Object.fromEntries(Object.keys(rules.groups).map(g => [g, { name: g.slice(g.lastIndexOf('/') + 1) }])),
  }
  const isLeaseHolder = takeLease(next, await $.session.id(), now)
  await setCache($, next)
  await setHealth($, { az: 'ok', isLeaseHolder, error: undefined })
  noteSuccess()
  await offer($, relatedOf(next, rules), ['related'])
}

/** Scan: re-reads the subscription's resource list and proposes; the first time it also adopts the sure group. */
async function scanProject($: EngineInterface, isFirst = false): Promise<void> {
  const project = await read($, projectAtom)
  // one Scan at a time: the first one at boot and a press must not both write the rules from empty
  if (project === null || (await read($, busyAtom)).scan) return
  await setBusy($, { scan: true })
  try {
    // no rules in state: the first adoption is still owed (a reset, or a first Scan that failed)
    const owed = isFirst || (await read($, rulesAtom)) === null
    if (!(await readList($))) return
    const sub = await currentSubscription($)
    if (sub.ok) await enrichList($, sub.sub.id)
    const saved = await savedRules($)
    const found = scanCandidates(project, project.key, mem.lastList, await projectFiles($, project.mainRoot), saved)
    await setHealth($, { az: 'ok' })
    const sure: AzSuggestion[] = []
    if (owed || saved === null) {
      await adoptFirst($, found.sure)
    } else if (found.sure !== null && !(found.sure in saved.groups) && !(found.sure in saved.dismissed)) {
      const name = mem.lastList.find(r => groupIdOf(r.id) === found.sure)?.resourceGroup ?? found.sure
      sure.push({ id: found.sure, kind: 'group', origin: 'scan', reason: 'similar-group', name })
    }
    // one offer: the sure group would be dropped by a second offer replacing the 'scan' ones
    await offer($, [...sure, ...found.probable], ['scan'])
    await updateProject($)
  } catch {
    // shortcut: an unexpected failure only ends this Scan; the button tries again
  } finally {
    await setBusy($, { scan: false })
  }
}

/**
 * First open: the sure group enters with «Uso rg-x (N) · Annulla»; the rules file is written either
 * way. Built on the rules as saved now: a resource added while the Scan waited for Azure stays.
 */
async function adoptFirst($: EngineInterface, sure: string | null): Promise<void> {
  const rules = await currentRules($)
  if (rules === null) return
  const adopt = sure !== null && !(sure in rules.groups) && !(sure in rules.dismissed)
  if (!(await setRules($, adopt ? addGroupTo(rules, sure, await $.clock.now()) : rules)) || !adopt) return
  await change($, autoAddedAtom, () => ({ groupId: sure, count: mem.lastList.filter(r => groupIdOf(r.id) === sure).length }))
}

async function refreshOne($: EngineInterface, id: AzId): Promise<void> {
  const rules = await read($, rulesAtom)
  const cache = await read($, cacheAtom)
  if (rules === null || cache === null) return
  await setBusyId($, id, true)
  try {
    const r = await readOne($, id, rules)
    if (!r.ok) return await noteFailure($, r)
    const latest = (await read($, cacheAtom)) ?? cache
    const old: AzCard | undefined = latest.resources[id]
    let card: AzCard | undefined
    if ('card' in r) card = old?.cost === undefined ? r.card : { ...r.card, cost: old.cost }
    else if (old !== undefined) card = { ...old, goneAt: old.goneAt ?? await $.clock.now() }
    if (card === undefined) return
    const resources = { ...latest.resources, [id]: card }
    if ('row' in r) linkRegistries(resources, [r.row])
    await setCache($, { ...latest, resources })
  } catch {
    // shortcut: a failed single read leaves the card as it was
  } finally {
    await setBusyId($, id, false)
  }
}

/**
 * The month's costs of every card (twice a day, or now with the button): one Cost Management
 * query for the groups plus the resources included from elsewhere. A refusal waits on its own
 * memory (Retry-After, else 30 min throttled / 60 min otherwise) and never touches the state loop.
 */
async function readCosts($: EngineInterface, force = false): Promise<void> {
  const [project, rules, cache, busy] = await Promise.all([read($, projectAtom), read($, rulesAtom), read($, cacheAtom), read($, busyAtom)])
  if (project === null || rules === null || cache === null || busy.cost) return
  const now = await $.clock.now()
  // a press waits for Azure too: pressing again while throttled only makes the wait longer
  if (now < costLoop.backoffUntil || (!force && !costDue(now, cache.costAt))) return
  const groupNames = Object.keys(rules.groups).map(g => g.slice(g.lastIndexOf('/') + 1))
  const ids = Object.keys(rules.includes).filter(id => !(groupIdOf(id) in rules.groups))
  if (groupNames.length === 0 && ids.length === 0) return
  const subId = cache.subscription.id
  await setBusy($, { cost: true })
  try {
    // one body file per project: the query changes every time, a hashed name would pile files up
    const bodyPath = `${await dataDir($)}/${project.key}.cost-query.json`
    await $.fs.write(bodyPath, JSON.stringify(costBody(groupNames, ids, now)))
    const r = await costPages($, costUrl(subId), bodyPath)
    if (!r.ok) {
      costLoop.backoffUntil = r.error.retryAt ?? now + (r.error.code === 'throttled' ? 30 : 60) * 60_000
      const error = r.error
      return await patchCache($, subId, c => ({ ...c, errors: { ...c.errors, cost: error } }))
    }
    costLoop.backoffUntil = 0
    const costs = parseCost(r.json, now, cache.cost?.currency)
    await patchCache($, subId, c => {
      const resources = Object.fromEntries(Object.entries(c.resources)
        .map(([id, card]) => [id, { ...card, cost: costs.byId[id] ?? { month: 0, prevMonth: null } }]))
      const { cost: _old, ...errors } = c.errors
      return { ...c, resources, errors, cost: { currency: costs.currency, ...costs.total }, costAt: now }
    })
  } catch {
    // shortcut: an unexpected failure only skips this read; the next tick or press tries again
  } finally {
    await setBusy($, { cost: false })
  }
}

/**
 * The week's changes in the project: one activity-log call per group, one per resource included
 * from elsewhere; every 15 min, or on opening a card when older than 2 min. A refusal waits on its
 * own memory (Retry-After, else 15 min) and never touches the state loop.
 */
async function readActivity($: EngineInterface, isOpening = false): Promise<void> {
  const [rules, cache] = await Promise.all([read($, rulesAtom), read($, cacheAtom)])
  if (rules === null || cache === null || activityLoop.isReading) return
  const now = await $.clock.now()
  if (!activityDue(now, cache.activityAt, isOpening) || now < activityLoop.backoffUntil) return
  const targets = [
    ...Object.keys(rules.groups).map(g => ({ group: g.slice(g.lastIndexOf('/') + 1) })),
    ...Object.keys(rules.includes).filter(id => !(groupIdOf(id) in rules.groups)).map(id => ({ id })),
  ]
  if (targets.length === 0) return
  const subId = cache.subscription.id
  activityLoop.isReading = true
  try {
    const rows: unknown[] = []
    let failed: AzError | undefined
    let answered = 0
    // one target refused (a group without access) keeps the others' changes, with its error beside them
    for (const target of targets) {
      const r = await runAz($, activityArgs(target, subId), 120_000)
      if (!r.ok) {
        failed ??= r.error
        continue
      }
      answered += 1
      if (Array.isArray(r.json)) rows.push(...(r.json as unknown[]))
    }
    if (answered === 0 && failed !== undefined) {
      activityLoop.backoffUntil = failed.retryAt ?? now + 15 * 60_000
      const error = failed
      return await patchCache($, subId, c => ({ ...c, errors: { ...c.errors, activity: error } }))
    }
    activityLoop.backoffUntil = 0
    const activity = parseActivity(rows, now)
    await patchCache($, subId, c => {
      const { activity: _old, ...errors } = c.errors
      return { ...c, errors: failed === undefined ? errors : { ...errors, activity: failed }, activity, activityAt: now }
    })
  } catch {
    // shortcut: an unexpected failure only skips this read; the next tick tries again
  } finally {
    activityLoop.isReading = false
  }
}

/** Takes a group's cards out of the photo (but those included one by one). */
async function dropGroupCards($: EngineInterface, groupId: string, rules: AzRules): Promise<void> {
  // the «Uso rg-x» line goes even when there is no photo yet (the first read failed)
  const auto = await read($, autoAddedAtom)
  if (auto?.groupId === groupId) await change($, autoAddedAtom, () => null)
  const cache = await read($, cacheAtom)
  if (cache === null) return
  const resources = Object.fromEntries(Object.entries(cache.resources).filter(([id]) => groupIdOf(id) !== groupId || id in rules.includes))
  await setCache($, { ...cache, resources })
}

async function includeResource($: EngineInterface, id: AzId): Promise<void> {
  if (isGroupId(id)) return addGroup($, id)
  const rules = await currentRules($)
  if (rules === null || !(await setRules($, includeIn(rules, id, await $.clock.now())))) return
  await dropSuggestion($, id)
  await refreshOne($, id)
}

async function excludeResource($: EngineInterface, id: AzId): Promise<void> {
  const rules = await currentRules($)
  if (rules !== null) await setRules($, excludeIn(rules, id, await $.clock.now()))
}

async function restoreResource($: EngineInterface, id: AzId): Promise<void> {
  const rules = await currentRules($)
  if (rules !== null) await setRules($, restoreIn(rules, id, await $.clock.now()))
}

async function addGroup($: EngineInterface, groupId: string): Promise<void> {
  const rules = await currentRules($)
  if (rules === null || !(await setRules($, addGroupTo(rules, groupId, await $.clock.now())))) return
  await dropSuggestion($, groupId)
  await updateProject($)
}

async function removeGroup($: EngineInterface, groupId: string): Promise<void> {
  const rules = await currentRules($)
  if (rules === null) return
  const next = removeGroupFrom(rules, groupId, await $.clock.now())
  if (await setRules($, next)) await dropGroupCards($, groupId, next)
}

/** «No» to a proposal; on the auto-added group («Annulla») it also takes the group and its cards out. */
async function dismissSuggestion($: EngineInterface, id: string): Promise<void> {
  const rules = await currentRules($)
  if (rules === null) return
  const next = dismissIn(rules, id, await $.clock.now())
  if (!(await setRules($, next))) return
  await dropSuggestion($, id)
  if (id in rules.groups) await dropGroupCards($, id, next)
}

async function undoAuto($: EngineInterface): Promise<void> {
  const auto = await read($, autoAddedAtom)
  if (auto !== null) await dismissSuggestion($, auto.groupId)
}

/** «Riparti da zero»: the broken file is kept aside, the rules start empty, Scan runs as on a first open. */
async function startOver($: EngineInterface): Promise<void> {
  const project = await read($, projectAtom)
  if (project === null) return
  const now = await $.clock.now()
  await writeReset($, project.key, emptyRules(project, now), now)
  await setHealth($, { rulesMode: 'ok' })
  await change($, rulesAtom, () => null)
  await scanProject($, true)
}

/** «+ Aggiungi»: ranks the last resource list read (reads one when there is none) and publishes it in `found`. */
export async function search($: EngineInterface, text: string): Promise<void> {
  try {
    // quiet: a failed read while typing must not delay the automatic Update
    if (mem.lastList.length === 0 && !(await readList($, true))) return
    const project = await read($, projectAtom)
    const touched = (await read($, eventsAtom)).map(e => e.name).filter((n): n is string => n !== undefined)
    const found = rankSearch(mem.lastList, text, { key: project?.key ?? '', touched, rules: await read($, rulesAtom) })
    await change($, foundAtom, () => found)
  } catch {
    // shortcut: a failed search leaves the last results; typing again retries
  }
}

// ---------------------------------------------------------------- hook support

/** The card an event names: by one of its --ids, else by name (and group when given). */
const cardFor = (cache: AzCache | null, e: AzEvent): AzCard | undefined => {
  if (cache === null) return undefined
  const byId = (e.ids ?? []).find(id => id in cache.resources)
  if (byId !== undefined) return cache.resources[byId]
  return e.name === undefined ? undefined
    : Object.values(cache.resources).find(c => c.name.toLowerCase() === e.name &&
      (e.group === undefined || c.group.toLowerCase() === e.group))
}

/** After an az command of Claude's: log it, then refresh what it changed or propose it. Never keeps the text. */
export async function afterAzCommand($: EngineInterface, e: AzEvent | 'unclear'): Promise<void> {
  try {
    if (e === 'unclear') return await updateProject($)
    const cache = await read($, cacheAtom)
    const card = cardFor(cache, e)
    if (card !== undefined) e.ids = [card.id]
    await change($, eventsAtom, l => [...l, e].slice(-100))
    // a read, or a command that failed or was denied, changed nothing in Azure
    if (!e.isWrite || e.exit !== 0) return
    if (card !== undefined) return await refreshOne($, card.id)
    const rules = await read($, rulesAtom)
    const groupId = cache !== null && e.group !== undefined ? `/subscriptions/${cache.subscription.id}/resourcegroups/${e.group}` : undefined
    if (rules !== null && groupId !== undefined && groupId in rules.groups) return await updateProject($)
    // something deleted outside the project is nothing to propose
    if (e.verb !== 'delete') await proposeWritten($, e, groupId)
  } catch {
    // shortcut: the hook's follow-up is best effort; the next Update catches up
  }
}

/** «Vista: X, la aggiungo?» — once, never when already claimed, excluded or dismissed. */
async function proposeWritten($: EngineInterface, e: AzEvent, groupId: string | undefined): Promise<void> {
  if (e.name === undefined && groupId === undefined && (e.ids ?? []).length === 0) return
  const find = (): ScanRow | undefined => mem.lastList.find(r => (e.ids ?? []).includes(r.id.toLowerCase()) ||
    (r.name.toLowerCase() === e.name && (e.group === undefined || r.resourceGroup.toLowerCase() === e.group)))
  // a resource Claude just created is not in a list read before: read it again once (quietly)
  let row = find()
  if (row === undefined && e.verb === 'create' && await readList($, true)) row = find()
  const id = row?.id.toLowerCase() ?? groupId ?? e.ids?.[0]
  if (id === undefined) return
  const rules = await read($, rulesAtom)
  if (rules !== null && (id in rules.dismissed || id in rules.includes || id in rules.excludes || id in rules.groups)) return
  if (row !== undefined) e.ids = [id]
  const kind = row === undefined && isGroupId(id) ? 'group' : 'resource'
  await offer($, [row !== undefined
    ? { id, kind, origin: 'hook', reason: 'claude-wrote', name: row.name, type: row.type.toLowerCase() }
    : { id, kind, origin: 'hook', reason: 'claude-wrote', name: kind === 'group' ? (e.group ?? id) : id.slice(id.lastIndexOf('/') + 1) }])
}

// ---------------------------------------------------------------- pane keys

/** Runs the action a pressed contract key asks for; a press also restarts a stopped automatic Update. */
async function runKey($: EngineInterface, action: PaneAction, arg: string | undefined): Promise<void> {
  // only a press that asks Azure for something restarts a stopped or waiting automatic Update
  if (action !== 'open' && action !== 'refresh-cost') resume()
  try {
    if (action === 'update') return await updateProject($)
    if (action === 'scan') return await scanProject($)
    if (action === 'reset-rules') return await startOver($)
    if (action === 'undo-auto') return await undoAuto($)
    if (action === 'refresh-cost') return await readCosts($, true)
    // the pane has already toggled the row (this runs after its press): read only on opening
    if (action === 'open') return (await read($, uiAtom)).openCard === arg ? await readActivity($, true) : undefined
    if (arg === undefined) return
    if (action === 'refresh') return await refreshOne($, arg)
    if (action === 'add') return await includeResource($, arg)
    if (action === 'exclude') return await excludeResource($, arg)
    if (action === 'restore') return await restoreResource($, arg)
    if (action === 'accept') return await includeResource($, arg)
    if (action === 'dismiss') return await dismissSuggestion($, arg)
    if (action === 'add-group') return await addGroup($, arg)
    if (action === 'remove-group') return await removeGroup($, arg)
  } catch {
    // shortcut: an action never throws to the pane; its outcome (or none) is in state
  }
}

export async function onPaneKey($: EngineInterface, key: string): Promise<void> {
  const k = parseKey(key)
  if (k !== null) await runKey($, k.action, k.arg)
}

// ---------------------------------------------------------------- boot and timer

async function tick($: EngineInterface): Promise<void> {
  const busy = await read($, busyAtom)
  const project = await read($, projectAtom)
  // no rules yet (a failed first Scan) is not a reason to stop: updateProject then scans again
  if (busy.update || busy.scan || project === null) return
  // a rules change saved by another session shows here and enters the next read; not while the
  // first adoption is owed (no rules in state, mode ok), or the empty file would cancel it
  if ((await read($, rulesAtom)) !== null || (await read($, healthAtom)).rulesMode !== 'ok') await savedRules($)
  const now = await $.clock.now()
  const placed = (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
  // costs and activities ride the same tick but not its rhythm: only the session that reads Azure
  if (placed && (await read($, healthAtom)).isLeaseHolder) {
    void readCosts($)
    void readActivity($)
  }
  let cache = await read($, cacheAtom)
  const disk = await loadCache($, project.key)
  // the file another session saved: its state when newer, and on their own its costs and activities
  // when newer (a press there, while this session runs the Updates)
  if (disk !== null) {
    const merged = (disk.stateAt ?? 0) > (cache?.stateAt ?? 0) ? keepNewerReads(disk, cache) : cache === null ? null : keepNewerReads(cache, disk)
    if (merged !== null && merged !== cache) {
      await change($, cacheAtom, current => keepNewerReads(merged, current))
      cache = await read($, cacheAtom)
    }
  }
  const lastInputAt = Math.max((await read($, uiAtom)).lastInputAt, loop.startedAt)
  const nextAutoAt = !placed || loop.isLoginStopped ? null
    : Math.max((cache?.stateAt ?? now) + intervalFor(now, lastInputAt), loop.backoffUntil)
  await setHealth($, { nextAutoAt })
  if (!shouldRefresh({ now, placed, lastInputAt, stateAt: cache?.stateAt, backoffUntil: loop.backoffUntil, isLoginStopped: loop.isLoginStopped })) return
  // the turn between sessions lives in the cache FILE: another session's lease on disk wins; mine is written there before reading Azure
  if (cache !== null) {
    const probe: AzCache = { ...cache, lease: disk?.lease ?? cache.lease }
    if (!takeLease(probe, await $.session.id(), now)) return await setHealth($, { isLeaseHolder: false })
    await saveCache($, probe)
  }
  await updateProject($)
}

async function startLoop($: EngineInterface): Promise<void> {
  loop.cancel?.()
  loop.startedAt = await $.clock.now()
  costLoop.backoffUntil = 0
  activityLoop.backoffUntil = 0
  activityLoop.isReading = false
  loop.cancel = $.clock.every(TICK_MS, () => { void tick($).catch(() => undefined) }).cancel
}

/** Session start: who we are, the saved rules and photo into state, Scan on a first open, then the timer. */
export async function boot($: EngineInterface): Promise<void> {
  try {
    const loaded = await loadRules($, await resolveProject($))
    const project = { ...loaded.project, key: loaded.key }
    await change($, projectAtom, () => project)
    await change($, rulesAtom, () => loaded.rules)
    await setHealth($, { rulesMode: loaded.mode })
    const cache = await loadCache($, loaded.key)
    if (cache !== null) await change($, cacheAtom, () => cache)
    await startLoop($)
    if (loaded.rules === null && loaded.mode === 'ok') await scanProject($, true)
  } catch {
    // shortcut: a failed boot leaves the pane empty; the next session start tries again
  }
}
