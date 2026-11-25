/*
 * actions.ts — what Raccolta does, as plain `function name($, ...)` declarations (the
 * engine refuses $ passed to object methods or arrow functions): boot at session start,
 * Scan, Update, refresh one resource, the rule changes behind the pane's button keys,
 * the «+ Aggiungi» search, and the 30 s timer of the automatic Update.
 * No action ever throws to its caller: the outcome lands in state (busy, health, cache,
 * rules, suggestions, found). Every rules change goes through saveRules (backup first).
 */
import { atom, read, update as change } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { currentSubscription, runAz } from './az'
import type { AzRun } from './az'
import { graphRows, markGone, readOne, readProject } from './graph'
import { resolveProject } from './project'
import { cacheForSubscription, loop, noteError, noteSuccess, resume, shouldRefresh, intervalFor, TICK_MS } from './refresh'
import {
  acceptInto, addGroupTo, dismissIn, excludeIn, includeIn, isGroupId, rankSearch, removeGroupFrom, restoreIn,
} from './rules-ops'
import { projectFiles, scanCandidates } from './scan'
import type { ScanRow } from './scan'
import { emptyRules, loadCache, loadRules, resetRules as writeReset, saveCache, saveRules, takeLease } from './store'
import { groupIdOf, PANE, parseKey } from '../contract'
import type { PaneAction } from '../contract'
import type { AzBusy, AzCache, AzCard, AzEvent, AzHealth, AzId, AzRules, AzSuggestion } from '../../types'

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
  { isVisible: false, lastInputAt: 0, openCard: null, showAuto: false, showHidden: false, isAdding: false }, { shape: 'ui-1' })

/** The last `az resource list` read in this module load (search and hook proposals rank it). */
const mem = { lastList: [] as ScanRow[] }

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

async function setCache($: EngineInterface, cache: AzCache): Promise<void> {
  await saveCache($, cache)
  await change($, cacheAtom, () => cache)
}

/** Saves and publishes new rules; refused (and nothing changes) in read-only or broken mode. */
async function setRules($: EngineInterface, rules: AzRules): Promise<boolean> {
  const project = await read($, projectAtom)
  const health = await read($, healthAtom)
  if (project === null || !(await saveRules($, project.key, rules, health.rulesMode))) return false
  await change($, rulesAtom, () => rules)
  return true
}

/** The rules to change: the saved ones, or empty ones when the project has none yet. */
async function currentRules($: EngineInterface): Promise<AzRules | null> {
  const project = await read($, projectAtom)
  if (project === null) return null
  return (await read($, rulesAtom)) ?? emptyRules(project, await $.clock.now())
}

async function noteFailure($: EngineInterface, run: Extract<AzRun, { ok: false }>): Promise<void> {
  const az = run.missing === true ? 'missing' : run.error.code === 'login' ? 'login' : undefined
  if (az !== undefined) await setHealth($, { az })
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

async function readList($: EngineInterface): Promise<boolean> {
  const r = await runAz($, ['resource', 'list', '--query', LIST_QUERY], 120_000)
  if (!r.ok) {
    await noteFailure($, r)
    return false
  }
  const rows = (Array.isArray(r.json) ? r.json : []) as ScanRow[]
  mem.lastList = rows.filter(x => typeof x?.id === 'string' && typeof x.name === 'string')
  return true
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

/** Update: re-reads every group and include of the project from Resource Graph. Never proposes, but related resources. */
export async function updateProject($: EngineInterface): Promise<void> {
  const project = await read($, projectAtom)
  const rules = await read($, rulesAtom)
  if (project === null || rules === null) return
  await setBusy($, { update: true })
  try {
    const sub = await currentSubscription($)
    if (!sub.ok) return await noteFailure($, sub)
    const cache = cacheForSubscription(await read($, cacheAtom), sub.sub, project.key)
    const r = await readProject($, rules, sub.sub.id)
    if (!r.ok) return await noteFailure($, r)
    const now = await $.clock.now()
    const { state: _old, ...errors } = cache.errors
    const next: AzCache = {
      ...cache, errors, stateAt: now, resources: markGone(cache.resources, r.cards, now, rules),
      groups: Object.fromEntries(Object.keys(rules.groups).map(g => [g, { name: g.slice(g.lastIndexOf('/') + 1) }])),
    }
    takeLease(next, await $.session.id(), now)
    await setCache($, next)
    await setHealth($, { az: 'ok', isLeaseHolder: true })
    noteSuccess()
    await offer($, relatedOf(next, rules), ['related'])
  } catch {
    // shortcut: an unexpected failure only ends this Update; the next tick or press tries again
  } finally {
    await setBusy($, { update: false })
  }
}

/** Scan: re-reads the subscription's resource list and proposes; the first time it also adopts the sure group. */
export async function scanProject($: EngineInterface, isFirst = false): Promise<void> {
  const project = await read($, projectAtom)
  if (project === null) return
  await setBusy($, { scan: true })
  try {
    if (!(await readList($))) return
    const sub = await currentSubscription($)
    if (sub.ok) await enrichList($, sub.sub.id)
    const saved = await read($, rulesAtom)
    const found = scanCandidates(project, project.key, mem.lastList, await projectFiles($, project.mainRoot), saved)
    await setHealth($, { az: 'ok' })
    if (isFirst || saved === null) {
      await adoptFirst($, found.sure)
    } else if (found.sure !== null && !(found.sure in saved.groups) && !(found.sure in saved.dismissed)) {
      const name = mem.lastList.find(r => groupIdOf(r.id) === found.sure)?.resourceGroup ?? found.sure
      await offer($, [{ id: found.sure, kind: 'group', origin: 'scan', reason: 'similar-group', name }])
    }
    await offer($, found.probable, ['scan'])
    await updateProject($)
  } catch {
    // shortcut: an unexpected failure only ends this Scan; the button tries again
  } finally {
    await setBusy($, { scan: false })
  }
}

/** First open: the sure group enters with «Uso rg-x (N) · Annulla»; the rules file is written either way. */
async function adoptFirst($: EngineInterface, sure: string | null): Promise<void> {
  const project = await read($, projectAtom)
  if (project === null) return
  const now = await $.clock.now()
  const rules = sure === null ? emptyRules(project, now) : addGroupTo(emptyRules(project, now), sure, now)
  if (!(await setRules($, rules)) || sure === null) return
  await change($, autoAddedAtom, () => ({ groupId: sure, count: mem.lastList.filter(r => groupIdOf(r.id) === sure).length }))
}

export async function refreshOne($: EngineInterface, id: AzId): Promise<void> {
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
    if (card !== undefined) await setCache($, { ...latest, resources: { ...latest.resources, [id]: card } })
  } catch {
    // shortcut: a failed single read leaves the card as it was
  } finally {
    await setBusyId($, id, false)
  }
}

/** Takes a group's cards out of the photo (but those included one by one). */
async function dropGroupCards($: EngineInterface, groupId: string, rules: AzRules): Promise<void> {
  const cache = await read($, cacheAtom)
  if (cache === null) return
  const resources = Object.fromEntries(Object.entries(cache.resources).filter(([id]) => groupIdOf(id) !== groupId || id in rules.includes))
  await setCache($, { ...cache, resources })
  const auto = await read($, autoAddedAtom)
  if (auto?.groupId === groupId) await change($, autoAddedAtom, () => null)
}

export async function includeResource($: EngineInterface, id: AzId): Promise<void> {
  if (isGroupId(id)) return addGroup($, id)
  const rules = await currentRules($)
  if (rules === null || !(await setRules($, includeIn(rules, id, await $.clock.now())))) return
  await dropSuggestion($, id)
  await refreshOne($, id)
}

export async function excludeResource($: EngineInterface, id: AzId): Promise<void> {
  const rules = await currentRules($)
  if (rules !== null) await setRules($, excludeIn(rules, id, await $.clock.now()))
}

export async function restoreResource($: EngineInterface, id: AzId): Promise<void> {
  const rules = await currentRules($)
  if (rules !== null) await setRules($, restoreIn(rules, id, await $.clock.now()))
}

export async function addGroup($: EngineInterface, groupId: string): Promise<void> {
  const rules = await currentRules($)
  if (rules === null || !(await setRules($, addGroupTo(rules, groupId, await $.clock.now())))) return
  await dropSuggestion($, groupId)
  await updateProject($)
}

export async function removeGroup($: EngineInterface, groupId: string): Promise<void> {
  const rules = await currentRules($)
  if (rules === null) return
  const next = removeGroupFrom(rules, groupId, await $.clock.now())
  if (await setRules($, next)) await dropGroupCards($, groupId, next)
}

export async function acceptSuggestion($: EngineInterface, id: string): Promise<void> {
  const all = [...(await read($, suggestionsAtom)), ...(await read($, foundAtom))]
  const s = all.find(x => x.id === id)
  const rules = await currentRules($)
  if (rules === null) return
  const next = s === undefined ? includeIn(rules, id, await $.clock.now()) : acceptInto(rules, s, await $.clock.now())
  if (!(await setRules($, next))) return
  await dropSuggestion($, id)
  if (id in next.groups) await updateProject($)
  else await refreshOne($, id)
}

/** «No» to a proposal; on the auto-added group («Annulla») it also takes the group and its cards out. */
export async function dismissSuggestion($: EngineInterface, id: string): Promise<void> {
  const rules = await currentRules($)
  if (rules === null) return
  const next = dismissIn(rules, id, await $.clock.now())
  if (!(await setRules($, next))) return
  await dropSuggestion($, id)
  if (id in rules.groups) await dropGroupCards($, id, next)
}

export async function undoAuto($: EngineInterface): Promise<void> {
  const auto = await read($, autoAddedAtom)
  if (auto !== null) await dismissSuggestion($, auto.groupId)
}

/** «Riparti da zero»: the broken file is kept aside, the rules start empty, Scan runs as on a first open. */
export async function startOver($: EngineInterface): Promise<void> {
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
  if (mem.lastList.length === 0 && !(await readList($))) return
  const project = await read($, projectAtom)
  const touched = (await read($, eventsAtom)).map(e => e.name).filter((n): n is string => n !== undefined)
  const found = rankSearch(mem.lastList, text, { key: project?.key ?? '', touched, rules: await read($, rulesAtom) })
  await change($, foundAtom, () => found)
}

// ---------------------------------------------------------------- hook support

/** The card an event names: by name (and group when given). */
const cardFor = (cache: AzCache | null, e: AzEvent): AzCard | undefined =>
  cache === null || e.name === undefined ? undefined
    : Object.values(cache.resources).find(c => c.name.toLowerCase() === e.name &&
      (e.group === undefined || c.group.toLowerCase() === e.group))

/** After an az command of Claude's: log it, then refresh what it changed or propose it. Never keeps the text. */
export async function afterAzCommand($: EngineInterface, e: AzEvent | 'unclear'): Promise<void> {
  try {
    if (e === 'unclear') return await updateProject($)
    const cache = await read($, cacheAtom)
    const card = cardFor(cache, e)
    if (card !== undefined) e.ids = [card.id]
    await change($, eventsAtom, l => [...l, e].slice(-100))
    if (!e.isWrite) return
    if (card !== undefined) return await refreshOne($, card.id)
    const rules = await read($, rulesAtom)
    const groupId = cache !== null && e.group !== undefined ? `/subscriptions/${cache.subscription.id}/resourcegroups/${e.group}` : undefined
    if (rules !== null && groupId !== undefined && groupId in rules.groups) return await updateProject($)
    await proposeWritten($, e, groupId)
  } catch {
    // shortcut: the hook's follow-up is best effort; the next Update catches up
  }
}

/** «Vista: X, la aggiungo?» — once, never when already claimed, excluded or dismissed. */
async function proposeWritten($: EngineInterface, e: AzEvent, groupId: string | undefined): Promise<void> {
  if (e.name === undefined && groupId === undefined) return
  if (mem.lastList.length === 0) await readList($)
  const row = mem.lastList.find(r => r.name.toLowerCase() === e.name && (e.group === undefined || r.resourceGroup.toLowerCase() === e.group))
  const id = row?.id.toLowerCase() ?? groupId
  if (id === undefined) return
  const rules = await read($, rulesAtom)
  if (rules !== null && (id in rules.dismissed || id in rules.includes || id in rules.excludes || id in rules.groups)) return
  if (row !== undefined) e.ids = [id]
  await offer($, [row !== undefined
    ? { id, kind: 'resource', origin: 'hook', reason: 'claude-wrote', name: row.name, type: row.type.toLowerCase() }
    : { id, kind: 'group', origin: 'hook', reason: 'claude-wrote', name: e.group ?? id }])
}

// ---------------------------------------------------------------- pane keys

/** Runs the action a pressed contract key asks for; a press also restarts a stopped automatic Update. */
export async function runKey($: EngineInterface, action: PaneAction, arg: string | undefined): Promise<void> {
  resume()
  try {
    if (action === 'update') return await updateProject($)
    if (action === 'scan') return await scanProject($)
    if (action === 'reset-rules') return await startOver($)
    if (action === 'undo-auto') return await undoAuto($)
    if (arg === undefined) return
    if (action === 'refresh') return await refreshOne($, arg)
    if (action === 'add') return await includeResource($, arg)
    if (action === 'exclude') return await excludeResource($, arg)
    if (action === 'restore') return await restoreResource($, arg)
    if (action === 'accept') return await acceptSuggestion($, arg)
    if (action === 'dismiss') return await dismissSuggestion($, arg)
    if (action === 'add-group') return await addGroup($, arg)
    if (action === 'remove-group') return await removeGroup($, arg)
    // 'open' (details on demand) and 'refresh-cost' arrive with later stages
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
  if (busy.update || busy.scan || project === null || (await read($, rulesAtom)) === null) return
  const now = await $.clock.now()
  const placed = (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
  let cache = await read($, cacheAtom)
  const disk = await loadCache($, project.key)
  if (disk !== null && (disk.stateAt ?? 0) > (cache?.stateAt ?? 0)) {
    cache = disk
    await change($, cacheAtom, () => disk)
  }
  const lastInputAt = Math.max((await read($, uiAtom)).lastInputAt, loop.startedAt)
  const nextAutoAt = !placed || loop.isLoginStopped ? null
    : Math.max((cache?.stateAt ?? now) + intervalFor(now, lastInputAt), loop.backoffUntil)
  await setHealth($, { nextAutoAt })
  if (!shouldRefresh({ now, placed, lastInputAt, stateAt: cache?.stateAt, backoffUntil: loop.backoffUntil, isLoginStopped: loop.isLoginStopped })) return
  if (cache !== null && !takeLease({ ...cache },await $.session.id(), now)) {
    return await setHealth($, { isLeaseHolder: false })
  }
  await updateProject($)
}

export async function startLoop($: EngineInterface): Promise<void> {
  loop.cancel?.()
  loop.startedAt = await $.clock.now()
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
