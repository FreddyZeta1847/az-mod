/*
 * rules.test.ts — tests of Raccolta's project identity (project.ts) and of the rules and
 * cache files (store.ts): worktree → main folder, folder without git, token stripped from
 * the remote, backup before save, broken files, newer versions, moved folder, same folder
 * name in another repository, and the refresh lease between sessions.
 * Pure functions are called directly; the file I/O goes through the whole mod (world.ts).
 */
import { expect, test } from 'claude-code/testing'

import { mainRootFrom, projectFrom, stripUserinfo } from './project'
import { chooseRules, emptyRules, migrateRules, planSave, resolveKey, takeLease } from './store'
import { startWorld } from './world'
import type { AzCache, AzProject, AzRules } from '../../types'

const P: AzProject = { key: 'demo-suite', mainRoot: '/work/demo-suite', remote: 'https://github.com/example/demo-suite' }
const rules = (over: Partial<AzRules> = {}): AzRules => ({ ...emptyRules(P, 1), ...over })

// ---------------------------------------------------------------- C1 identity

test('worktree resolves to main', async () => {
  expect(mainRootFrom({ root: '/work/demo-suite/.claude/worktrees/x', vcsMainRoot: '/work/demo-suite', commonDir: null })).toBe('/work/demo-suite')
  expect(mainRootFrom({ root: '/work/demo-suite/.claude/worktrees/x', vcsMainRoot: null, commonDir: '/work/demo-suite/.git' })).toBe('/work/demo-suite')
  expect(mainRootFrom({ root: 'C:\\work\\Demo Suite', vcsMainRoot: null, commonDir: null })).toBe('C:\\work\\Demo Suite')
  expect(projectFrom('C:\\work\\Demo Suite', null).key).toBe('demo-suite')
})

test('project without git', async ($, on) => {
  const w = startWorld(on)
  await w.start($)
  expect(w.seen.project).toEqual({ key: 'demo-suite', mainRoot: '/work/demo-suite', remote: null })
})

test('remote token stripped', async () => {
  expect(stripUserinfo('https://u:ghp_abc@github.com/x/y.git')).toBe('https://github.com/x/y')
  expect(stripUserinfo('https://GitHub.com/x/y')).toBe('https://github.com/x/y')
  expect(stripUserinfo('git@github.com:x/y.git')).toBe('git@github.com:x/y')
})

// ---------------------------------------------------------------- C2 files

test('bak written before save', async () => {
  const writes = planSave('/data/projects', 'demo-suite', '{"old":1}', rules())
  expect(writes.map(x => x[0])).toEqual(['/data/projects/demo-suite.rules.bak.json', '/data/projects/demo-suite.rules.json'])
  expect(writes[0]?.[1]).toBe('{"old":1}')
  expect(planSave('/data/projects', 'demo-suite', undefined, rules()).length).toBe(1)
})

test('broken file falls back to bak', async () => {
  const good = JSON.stringify(rules({ groups: { '/subscriptions/0/resourcegroups/rg-demo-suite': { at: 1 } } }))
  const chosen = chooseRules('{ not json', good)
  expect(chosen.mode).toBe('ok')
  expect(Object.keys(chosen.rules?.groups ?? {})).toEqual(['/subscriptions/0/resourcegroups/rg-demo-suite'])
})

test('both broken → broken mode, no auto scan', async ($, on) => {
  const w = startWorld(on, { files: { '/data/projects/demo-suite.rules.json': '{x', '/data/projects/demo-suite.rules.bak.json': '[1' } })
  await $.session.start({ cwd: '/work/demo-suite', surface: 'desktop', isInteractive: true })
  await w.waitFor(() => w.seen.health?.rulesMode === 'broken')
  await w.pause(200)
  expect(w.runs.some(a => a[1] === 'resource' && a[2] === 'list')).toBe(false)
  expect(w.files.get('/data/projects/demo-suite.rules.json')).toBe('{x')
})

test('newer version → read-only, never written', async () => {
  expect(() => migrateRules({ ...rules(), schemaVersion: 2 })).toThrow()
  const chosen = chooseRules(JSON.stringify({ ...rules(), schemaVersion: 2 }), undefined)
  expect(chosen.mode).toBe('read-only')
  expect(chooseRules(undefined, undefined)).toEqual({ rules: null, mode: 'ok' })
})

test('moved folder', async () => {
  const saved = rules({ project: { key: 'demo-suite', mainRoot: '/old/place/demo-suite', remote: P.remote } })
  const r = resolveKey(P, saved)
  expect(r.key).toBe('demo-suite')
  expect(r.project.conflict).toBeUndefined()
  expect(r.mainRootMoved).toBe(true)
})

test('same name other repo', async () => {
  const saved = rules({ project: { key: 'demo-suite', mainRoot: '/a/demo-suite', remote: 'https://github.com/other/demo-suite' } })
  const r = resolveKey(P, saved)
  expect(/^demo-suite-[0-9a-f]{6}$/.test(r.key)).toBe(true)
  expect(r.project.conflict).toBe('other-repo')
  expect(resolveKey(P, saved).key).toBe(r.key)
})

const cache = (lease?: AzCache['lease']): AzCache => ({
  schemaVersion: 1, projectKey: 'demo-suite', subscription: { id: '0', name: 'Demo' }, lease,
  groups: {}, resources: {}, activity: [], errors: {},
})

test('lease held by other session', async () => {
  const c = cache({ by: 's2', until: 1_000_000 })
  expect(takeLease(c, 's1', 990_000)).toBe(false)
  expect(c.lease?.by).toBe('s2')
  expect(takeLease(cache({ by: 's1', until: 1_000_000 }), 's1', 990_000)).toBe(true)
})

test('lease expired is taken', async () => {
  const c = cache({ by: 's2', until: 1_000_000 })
  expect(takeLease(c, 's1', 1_000_001)).toBe(true)
  expect(c.lease).toEqual({ by: 's1', until: 1_060_001 })
  expect(takeLease(cache(), 's1', 5)).toBe(true)
})
