/*
 * scanner.test.ts — tests of the scanner (scan.ts: the sure group from the folder name,
 * probable resources with their reason, nothing proposed twice) and of the pure rule
 * changes behind the pane's buttons (accept, dismiss, «Annulla», remove group, restore,
 * search ranking, reset). The key wiring is tested in keys.test.tsx.
 */
import { expect, test } from 'claude-code/testing'

import { addGroupTo, dismissIn, includeIn, isGroupId, rankSearch, removeGroupFrom, restoreIn } from './rules-ops'
import { scanCandidates } from './scan'
import type { ScanRow } from './scan'
import { emptyRules, planReset } from './store'
import { BOTTEGA_REMOTE, gid, RESOURCE_LIST } from '../fixtures/azure'
import type { AzProject, AzRules, AzSuggestion } from '../../types'

const project = (key: string, remote: string | null = null): AzProject => ({ key, mainRoot: `/work/${key}`, remote })
const NO_FILES = { names: [], text: '' }
const rows: ScanRow[] = RESOURCE_LIST.map(r => (r.name === 'bottega-web-app' ? { ...r, repositoryUrl: `${BOTTEGA_REMOTE}.git` } : r))
const DEMO = gid('rg-demo-suite')
const rules = (over: Partial<AzRules> = {}): AzRules => ({ ...emptyRules(project('demo-suite'), 1), ...over })
const sug = (id: string, kind: AzSuggestion['kind'] = 'resource'): AzSuggestion =>
  ({ id, kind, origin: 'scan', reason: 'similar-group', name: id.slice(id.lastIndexOf('/') + 1) })

// ---------------------------------------------------------------- F1 scanner

test('bottega-web found by name and repo', async () => {
  const r = scanCandidates(project('bottega-web', BOTTEGA_REMOTE), 'bottega-web', rows, NO_FILES, null)
  expect(r.sure).toBe(gid('rg_Bottega-Web'))
  // its static site is inside the sure group: not proposed again
  expect(r.probable.length).toBe(0)
  const other = scanCandidates(project('bottega', BOTTEGA_REMOTE), 'bottega', rows, NO_FILES, null)
  const site = other.probable.find(s => s.name === 'bottega-web-app')
  expect(site?.reason).toBe('same-repo')
})

test('rg_Bottega-Web normalized', async () => {
  expect(scanCandidates(project('bottega-web'), 'bottega-web', rows, NO_FILES, null).sure).toBe(gid('rg_bottega-web'))
})

test('demo-suite sure', async () => {
  const r = scanCandidates(project('demo-suite'), 'demo-suite', rows, NO_FILES, null)
  expect(r.sure).toBe(DEMO)
  const old = r.probable.find(s => s.id === gid('rg-demo-suite-old'))
  expect(old).toEqual({ id: gid('rg-demo-suite-old'), kind: 'group', origin: 'scan', reason: 'similar-group', name: 'rg-demo-suite-old', count: 1 })
  const named = scanCandidates(project('demo-suite'), 'demo-suite', rows, { names: [], text: 'Deploys to tasklist and oldshop.' }, null)
  expect(named.probable.filter(s => s.reason === 'named-in-files').map(s => s.name).sort()).toEqual(['oldshop', 'tasklist'])
})

test('dismissed not proposed again', async () => {
  const saved = rules({ dismissed: { [gid('rg-demo-suite-old')]: { at: 1 } }, groups: { [DEMO]: { at: 1 } } })
  const r = scanCandidates(project('demo-suite'), 'demo-suite', rows, NO_FILES, saved)
  expect(r.probable.some(s => s.id === gid('rg-demo-suite-old'))).toBe(false)
})

test('similar names stay probable', async () => {
  const twin: ScanRow[] = [...rows, { id: `${gid('RG_Demo_Suite')}/providers/microsoft.web/sites/x`, name: 'x', type: 'microsoft.web/sites', resourceGroup: 'RG_Demo_Suite' }]
  const r = scanCandidates(project('demo-suite'), 'demo-suite', twin, NO_FILES, null)
  expect(r.sure).toBeNull()
  expect(r.probable.filter(s => s.kind === 'group' && s.reason === 'similar-group').length).toBe(3)
})

// ---------------------------------------------------------------- F2 rule changes

test('accept adds include', async () => {
  // «accept» runs includeResource: a resource id is included, a group id becomes a group
  const id = `${gid('rg-tasklist')}/providers/microsoft.web/sites/tasklist`
  const r = includeIn(rules({ excludes: { [id]: { at: 1 } } }), id, 9)
  expect(r.includes[id]).toEqual({ at: 9 })
  expect(r.excludes[id]).toBeUndefined()
  expect(isGroupId(gid('rg-tasklist'))).toBe(true)
  expect(Object.keys(addGroupTo(rules(), gid('rg-tasklist'), 9).groups)).toEqual([gid('rg-tasklist')])
})

test('dismiss remembered', async () => {
  expect(dismissIn(rules(), 'x', 9).dismissed.x).toEqual({ at: 9 })
})

test('Annulla on auto group dismisses it', async () => {
  const r = dismissIn(rules({ groups: { [DEMO]: { at: 1 } } }), DEMO, 9)
  expect(r.groups[DEMO]).toBeUndefined()
  expect(r.dismissed[DEMO]).toEqual({ at: 9 })
})

test('removeGroup', async () => {
  const r = removeGroupFrom(rules({ groups: { [DEMO]: { at: 1 } } }), DEMO, 9)
  expect(Object.keys(r.groups)).toEqual([])
  expect(r.updatedAt).toBe(9)
})

test('restore from hidden', async () => {
  expect(restoreIn(rules({ excludes: { a: { at: 1 } } }), 'a', 9).excludes).toEqual({})
})

test('search ranks touched first', async () => {
  const found = rankSearch(rows, 'demo', { key: 'demo-suite', touched: ['demo-suite-legacy'], rules: rules({ groups: { [DEMO]: { at: 1 } } }) })
  expect(found[0]?.name).toBe('demo-suite-legacy')
  expect(found.some(s => s.id.startsWith(`${DEMO}/`))).toBe(false)
  expect(found.some(s => s.kind === 'group' && s.id === gid('rg-demo-suite-old'))).toBe(true)
  expect(rankSearch(rows, '', { key: 'demo-suite', touched: [], rules: null }).length).toBeLessThan(21)
})

test('resetRules from broken', async () => {
  const fresh = emptyRules(project('demo-suite'), 9)
  const writes = planReset('/d', 'demo-suite', '{x', fresh, 9)
  expect(writes.map(x => x[0])).toEqual(['/d/demo-suite.broken-9.json', '/d/demo-suite.rules.json'])
  expect(writes[0]?.[1]).toBe('{x')
})

