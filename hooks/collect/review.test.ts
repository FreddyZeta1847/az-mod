/*
 * review.test.ts — regression tests for the findings of review round 1 (blueprint
 * reviews, «Raccolta e pannello»): one test per finding that can be reproduced, named
 * after its id (f1…f19). Pure helpers are tested directly; the actions through the whole
 * mod over world.ts (and the real pane where a press is needed).
 */
import { expect, test } from 'claude-code/testing'

import { bodyFileFor, isGoneMessage, markGone, rowToCard, SHOW_QUERY } from './graph'
import { parseAz } from './parse-az'
import { projectFrom } from './project'
import { cleanValue } from './secrets'
import { dataDirFrom, resolveKey } from './store'
import { NOW, result, startWorld } from './world'
import { DEMO_SUITE_ROWS, gid, RESOURCE_LIST, rid } from '../fixtures/azure'
import type { GraphRow } from '../fixtures/azure'
import type { AzCard, AzProject, AzRules } from '../../types'

const PANE = {
  plugin: 'az-mod', component: 'Pane', requestId: 'az-mod', surface: 'desktop',
  props: { title: 'Azure', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const idOf = (name: string): string => DEMO_SUITE_ROWS.find(r => r.name === name)?.id as string
const appRow = DEMO_SUITE_ROWS.find(r => r.name === 'app-control') as GraphRow
const card = (over: Partial<AzCard> = {}): AzCard => ({
  id: idOf('app-control'), name: 'app-control', type: 'microsoft.app/containerapps', group: 'rg-demo-suite', location: 'westeurope',
  status: 'ok', autoCreated: false, via: 'group', facts: {}, uses: [], warnings: [], stateAt: 0, ...over,
})
const project = (over: Partial<AzProject> = {}): AzProject => ({ key: 'api', mainRoot: '/a/api', remote: null, ...over })
const rulesOf = (p: AzProject): AzRules => ({
  schemaVersion: 1, project: { key: p.key, mainRoot: p.mainRoot, remote: p.remote }, groups: {}, includes: {}, excludes: {}, dismissed: {}, updatedAt: 0,
})

// ---------------------------------------------------------------- pure helpers

test('f1 each query and page has its own body file', async () => {
  expect(bodyFileFor('/d', 's', 'q1')).not.toBe(bodyFileFor('/d', 's', 'q2'))
  expect(bodyFileFor('/d', 's', 'q1')).toBe(bodyFileFor('/d', 's', 'q1'))
  expect(bodyFileFor('/d', 's', 'q1', 'tok')).not.toBe(bodyFileFor('/d', 's', 'q1'))
  expect(bodyFileFor('/d', 's', 'q1').startsWith('/d/graph-')).toBe(true)
})

test('f3 names and groups in capitals are understood', async () => {
  const e = parseAz('az webapp restart -n MyApp -g Rg_Demo.Web', NOW, 's1')
  expect(e !== null && e !== 'unclear' ? [e.name, e.group] : e).toEqual(['myapp', 'rg_demo.web'])
})

test('f5 a single read asks for the same facts as the full read', async () => {
  for (const field of ['defaultHostName', 'loginServer', 'enableFreeTier', 'userAssignedIdentities', 'ingress.traffic', 'customDomains']) {
    expect([field, SHOW_QUERY.includes(field)]).toEqual([field, true])
  }
  const identity = rid('rg-demo-suite', 'microsoft.managedidentity/userassignedidentities', 'id-x')
  const shown = rowToCard({ ...appRow, identityIds: { [identity]: {} } as unknown as string[] }, NOW, 'group')
  expect(shown.uses).toContain(identity)
  const storage = rowToCard({ ...appRow, type: 'microsoft.storage/storageaccounts', sku: 'Standard_GRS', redundancy: null }, NOW, 'group')
  expect(storage.facts.redundancy).toBe('GRS')
})

test('f6 a commit hash in an image tag is not a secret', async () => {
  const sha = 'a3f1c9e07b2d4458c0e6f19a2b7d3c5e8f0a1b2c'
  expect(cleanValue(`acrdemosuite.azurecr.io/app:${sha}`)).toBe(`acrdemosuite.azurecr.io/app:${sha}`)
  expect(cleanValue('Zm9vYmFyQmF6UXV4MTIzNDU2Nzg5MEFCQ0RFRkdISUpL')).toBeUndefined()
})

test('f7 a deleted group means the resource is gone', async () => {
  expect(isGoneMessage("(ResourceGroupNotFound) Resource group 'rg-x' could not be found.")).toBe(true)
  expect(isGoneMessage("(ResourceNotFound) The Resource 'x' was not found.")).toBe(true)
  expect(isGoneMessage('(AuthorizationFailed) no access')).toBe(false)
})

test('f10 no plugin data folder means no writes at all', async () => {
  expect(() => dataDirFrom({})).toThrow()
  expect(dataDirFrom({ CLAUDE_PLUGIN_DATA: 'C:/data/' })).toBe('C:/data/projects')
})

test('f11 same folder name, no remote, other place: another project', async () => {
  const saved = rulesOf(project())
  const r = resolveKey(project({ mainRoot: '/b/api' }), saved)
  expect(r.key).not.toBe('api')
  expect(r.project.conflict).toBe('other-repo')
  expect(resolveKey(project(), saved).key).toBe('api')
})

test('f12 a folder with no latin letters still has a key', async () => {
  const key = projectFrom('/x/日本', null).key
  expect(key.length).toBeGreaterThan(2)
  expect(key).not.toBe(projectFrom('/y/日本', null).key)
})

test('f13 a repository address keeps no user or token', async () => {
  const site = rowToCard({ ...appRow, type: 'microsoft.web/staticsites', repositoryUrl: 'https://user:abc123@github.com/example/site.git' }, NOW, 'group')
  expect(site.facts.repositoryUrl).toBe('https://github.com/example/site')
  expect(cleanValue(`https://github.com/x?t=ghp_${'Ab1'.repeat(12)}`)).toBeUndefined()
})

test('f14 a full read keeps the cost of a card', async () => {
  const id = idOf('app-control')
  const out = markGone({ [id]: card({ cost: { month: 4, prevMonth: 3 } }) }, { [id]: card() }, NOW, { groups: { [gid('rg-demo-suite')]: { at: 0 } }, includes: {} })
  expect(out[id]?.cost).toEqual({ month: 4, prevMonth: 3 })
})

test('f17 the word az alone is not an az command', async () => {
  expect(parseAz('grep -rn az hooks/', NOW, 's1')).toBe(null)
  expect(parseAz('az webapp list | jq .', NOW, 's1')).toBe('unclear')
})

// ---------------------------------------------------------------- through the mod

test('f2 a later Scan proposes the project group', async ($, on) => {
  const saved = rulesOf({ key: 'demo-suite', mainRoot: '/work/demo-suite', remote: null })
  const w = startWorld(on, { files: { '/data/projects/demo-suite.rules.json': JSON.stringify(saved) } })
  await $.session.start({ cwd: '/work/demo-suite', surface: 'desktop', isInteractive: true })
  await w.waitFor(() => w.seen.rules != null && w.idle())
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'scan' })
  await w.waitFor(() => (w.seen.suggestions ?? []).some(s => s.id === gid('rg-demo-suite')))
  await ui.unmount()
})

test('f4 a write by --ids refreshes that card', async ($, on) => {
  const w = startWorld(on)
  await w.start($)
  w.runs.length = 0
  await $.tool.call({ tool: 'Bash', command: `az resource delete --ids ${idOf('app-match')}` })
  await w.waitFor(() => w.runs.some(a => a[2] === 'show' && a.includes(idOf('app-match'))))
})

test('f8 a resource created later in another group is proposed by itself', async ($, on) => {
  let lists = 0
  const fresh = { id: rid('rg-tasklist', 'microsoft.web/sites', 'fresh-app'), name: 'fresh-app', type: 'microsoft.web/sites', resourceGroup: 'rg-tasklist' }
  const w = startWorld(on, {
    az: argv => (argv[1] === 'resource' && argv[2] === 'list'
      ? result(0, JSON.stringify(++lists === 1 ? RESOURCE_LIST : [...RESOURCE_LIST, fresh])) : undefined),
  })
  await w.start($)
  await $.tool.call({ tool: 'Bash', command: 'az webapp create -n fresh-app -g rg-tasklist' })
  await w.waitFor(() => (w.seen.suggestions ?? []).some(s => s.origin === 'hook'))
  const s = (w.seen.suggestions ?? []).find(x => x.origin === 'hook')
  expect([s?.kind, s?.name]).toEqual(['resource', 'fresh-app'])
})

test('f9 accepting a group puts it among the groups', async ($, on) => {
  const w = startWorld(on)
  await w.start($)
  const ui = await $.ui.mount(PANE)
  // the first Scan proposed the similar group: its chip is drawn, accepting it goes through includeResource
  const old = gid('rg-demo-suite-old')
  await ui.press({ key: `accept-${old}` })
  await w.waitFor(() => old in (w.seen.rules?.groups ?? {}))
  expect(old in (w.seen.rules?.includes ?? {})).toBe(false)
  await ui.unmount()
})
