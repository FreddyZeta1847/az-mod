/*
 * store.ts — the rules and cache files of a project, in CLAUDE_PLUGIN_DATA/projects/:
 * <key>.rules.json (kept forever, versioned), <key>.rules.bak.json (the previous text,
 * written before every save), <key>.broken-<ms>.json (a broken file kept by «riparti da
 * zero»), <key>.cache.json (the last photo of Azure, discardable). $.fs cannot delete or
 * rename, so nothing here relies on either.
 * Pure helpers decide (chooseRules, resolveKey, planSave, takeLease); the async functions
 * only read and write.
 */
import type { EngineInterface } from 'claude-code'

import type { AzCache, AzProject, AzRules } from '../../types'

export type RulesMode = 'ok' | 'read-only' | 'broken'
const LEASE_MS = 60_000

const rulesPath = (dir: string, key: string): string => `${dir}/${key}.rules.json`
const bakPath = (dir: string, key: string): string => `${dir}/${key}.rules.bak.json`
const cachePath = (dir: string, key: string): string => `${dir}/${key}.cache.json`

export const emptyRules = (p: AzProject, now: number): AzRules => ({
  schemaVersion: 1, project: { key: p.key, mainRoot: p.mainRoot, remote: p.remote },
  groups: {}, includes: {}, excludes: {}, dismissed: {}, updatedAt: now,
})

class NewerVersion extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Checks a parsed rules file. Only version 1 exists: a higher one throws NewerVersion, anything else throws. */
export const migrateRules = (raw: unknown): AzRules => {
  if (!isRecord(raw) || typeof raw.schemaVersion !== 'number') throw new Error('not a rules file')
  if (raw.schemaVersion > 1) throw new NewerVersion(`rules version ${raw.schemaVersion}`)
  const p = raw.project
  const ok = raw.schemaVersion === 1 && isRecord(p) && typeof p.key === 'string' && typeof p.mainRoot === 'string'
    && ['groups', 'includes', 'excludes', 'dismissed'].every(k => isRecord(raw[k]))
  if (!ok) throw new Error('broken rules file')
  return raw as unknown as AzRules
}

type Parsed = { rules: AzRules } | { newer: AzRules } | null
const parse = (text: string | undefined): Parsed => {
  if (text === undefined) return null
  try {
    return { rules: migrateRules(JSON.parse(text)) }
  } catch (e) {
    return e instanceof NewerVersion ? { newer: JSON.parse(text as string) as AzRules } : null
  }
}

/** Main file first, its backup when it is broken; both broken → 'broken'; newer → shown, never written. */
export const chooseRules = (main: string | undefined, bak: string | undefined): { rules: AzRules | null; mode: RulesMode } => {
  if (main === undefined) return { rules: null, mode: 'ok' }
  const m = parse(main)
  if (m !== null) return 'rules' in m ? { rules: m.rules, mode: 'ok' } : { rules: m.newer, mode: 'read-only' }
  const b = parse(bak)
  if (b !== null && 'rules' in b) return { rules: b.rules, mode: 'ok' }
  return { rules: null, mode: 'broken' }
}

/** Six hex characters of a string (FNV-1a), for the key of a second repository with the same folder name. */
export const hash6 = (s: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0').slice(0, 6)
}

/**
 * Same key, other repository → `<key>-<hash6>` and a conflict; same repository elsewhere → moved folder.
 * With both remotes known the remote decides; without one the folder does (a moved folder
 * without remote then counts as another project: safer than sharing someone else's rules).
 */
/** A folder in one spelling: on Windows `c:\x` and `C:/x/` are the same folder. */
const samePath = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

export const resolveKey = (p: AzProject, saved: AzRules | null): { key: string; project: AzProject; mainRootMoved: boolean } => {
  if (saved === null) return { key: p.key, project: p, mainRootMoved: false }
  const bothRemotes = saved.project.remote !== null && p.remote !== null
  const other = bothRemotes ? saved.project.remote !== p.remote : samePath(saved.project.mainRoot) !== samePath(p.mainRoot)
  if (other) return { key: `${p.key}-${hash6(p.remote ?? p.mainRoot)}`, project: { ...p, conflict: 'other-repo' }, mainRootMoved: false }
  return { key: p.key, project: p, mainRootMoved: samePath(saved.project.mainRoot) !== samePath(p.mainRoot) }
}

/** The writes of one save: the backup of the previous text first — only when it is a good rules file, so a broken one never replaces a good backup — then the new file. */
export const planSave = (dir: string, key: string, previous: string | undefined, rules: AzRules): Array<[string, string]> => {
  const next: [string, string] = [rulesPath(dir, key), JSON.stringify(rules, null, 1)]
  const prev = parse(previous)
  return prev === null || !('rules' in prev) ? [next] : [[bakPath(dir, key), previous as string], next]
}

/** «Riparti da zero»: keep the broken text aside, then start from empty rules. */
export const planReset = (dir: string, key: string, broken: string | undefined, fresh: AzRules, now: number): Array<[string, string]> => {
  const next: [string, string] = [rulesPath(dir, key), JSON.stringify(fresh, null, 1)]
  return broken === undefined ? [next] : [[`${dir}/${key}.broken-${now}.json`, broken], next]
}

/** Free, expired or already mine → mine for LEASE_MS more. Mutates the cache. */
export const takeLease = (cache: AzCache, sessionId: string, now: number): boolean => {
  const l = cache.lease
  if (l !== undefined && l.by !== sessionId && l.until >= now) return false
  cache.lease = { by: sessionId, until: now + LEASE_MS }
  return true
}

/** A cache file is used only when it parses, has version 1 and belongs to this key. */
export const parseCache = (text: string | undefined, key: string): AzCache | null => {
  if (text === undefined) return null
  try {
    const c = JSON.parse(text) as AzCache
    return isRecord(c) && c.schemaVersion === 1 && c.projectKey === key && isRecord(c.resources) ? c : null
  } catch {
    return null
  }
}

/** The projects folder under the plugin's data folder; without one nothing is written (never the user's repository). */
export const dataDirFrom = (env: Record<string, string>): string => {
  const base = env.CLAUDE_PLUGIN_DATA
  if (base === undefined || base.trim() === '') throw new Error('az-mod: no CLAUDE_PLUGIN_DATA, nothing is written')
  return `${base.replace(/[\\/]+$/, '')}/projects`
}

export async function dataDir($: EngineInterface): Promise<string> {
  return dataDirFrom(await $.process.hookEnv())
}

export async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    if (!(await $.fs.exists(path))) return undefined
    const text = await $.fs.read(path)
    return typeof text === 'string' ? text : undefined
  } catch {
    return undefined
  }
}

async function writeAll($: EngineInterface, writes: Array<[string, string]>): Promise<void> {
  for (const [path, text] of writes) await $.fs.write(path, text)
}

export async function loadRules($: EngineInterface, p: AzProject):
  Promise<{ rules: AzRules | null; mode: RulesMode; key: string; project: AzProject }> {
  const dir = await dataDir($)
  const first = chooseRules(await readText($, rulesPath(dir, p.key)), await readText($, bakPath(dir, p.key)))
  const r = resolveKey(p, first.rules)
  if (r.key === p.key) {
    const rules = first.rules !== null && r.mainRootMoved
      ? { ...first.rules, project: { ...first.rules.project, mainRoot: p.mainRoot } }
      : first.rules
    if (rules !== first.rules && first.mode === 'ok') await saveRules($, p.key, rules as AzRules, 'ok')
    return { rules, mode: first.mode, key: p.key, project: r.project }
  }
  const second = chooseRules(await readText($, rulesPath(dir, r.key)), await readText($, bakPath(dir, r.key)))
  return { ...second, key: r.key, project: r.project }
}

/**
 * The rules file right now (another session may have saved since boot), with its mode. Only the
 * main file: mid-session, a half-written one must not bring back the older backup ('broken' then).
 */
export async function readSavedRules($: EngineInterface, key: string): Promise<{ rules: AzRules | null; mode: RulesMode }> {
  return chooseRules(await readText($, rulesPath(await dataDir($), key)), undefined)
}

/** Writes the rules with a backup of the previous text first; refused in read-only and broken mode. */
export async function saveRules($: EngineInterface, key: string, rules: AzRules, mode: RulesMode): Promise<boolean> {
  if (mode !== 'ok') return false
  const dir = await dataDir($)
  await writeAll($, planSave(dir, key, await readText($, rulesPath(dir, key)), rules))
  return true
}

export async function resetRules($: EngineInterface, key: string, fresh: AzRules, now: number): Promise<void> {
  const dir = await dataDir($)
  await writeAll($, planReset(dir, key, await readText($, rulesPath(dir, key)), fresh, now))
}

export async function loadCache($: EngineInterface, key: string): Promise<AzCache | null> {
  return parseCache(await readText($, cachePath(await dataDir($), key)), key)
}

export async function saveCache($: EngineInterface, cache: AzCache): Promise<void> {
  await $.fs.write(cachePath(await dataDir($), cache.projectKey), JSON.stringify(cache))
}
