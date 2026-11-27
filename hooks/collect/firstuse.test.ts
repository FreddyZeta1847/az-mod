/*
 * firstuse.test.ts — regression tests for what the first-use test on real Azure found
 * («Raccolta e pannello», 2026-11-25), one test per finding (u1, u2, …). The fake Azure of
 * the other tests accepted any query text, so these pin the query text itself.
 */
import { expect, test } from 'claude-code/testing'

import { buildQuery, rowToCard, SHOW_QUERY } from './graph'
import { NOW, ROOT, startWorld } from './world'
import { DEMO_SUITE_ROWS, gid } from '../fixtures/azure'
import type { GraphRow } from '../fixtures/azure'
import type { AzRules } from '../../types'

test('u1 every column name is quoted: kind is a KQL keyword', async () => {
  const q = buildQuery([gid('rg-demo-suite')], [])
  expect(q.includes("['kind'] = kind")).toBe(true)
  // Resource Graph refused `kind = kind` with ParserFailure at the `=`
  expect(/[ ,]kind =/.test(q)).toBe(false)
})

test('u2 static sites give their address (defaultHostname, small n)', async () => {
  expect(buildQuery([gid('rg-demo-suite')], []).includes('properties.defaultHostname')).toBe(true)
  expect(SHOW_QUERY.includes('properties.defaultHostname')).toBe(true)
})

test('u3 no groups and no resources: Azure is not asked, the photo is empty', async ($, on) => {
  const saved: AzRules = {
    schemaVersion: 1, project: { key: 'demo-suite', mainRoot: '/work/demo-suite', remote: null },
    groups: {}, includes: {}, excludes: {}, dismissed: {}, updatedAt: 0,
  }
  const w = startWorld(on, { files: { '/data/projects/demo-suite.rules.json': JSON.stringify(saved) } })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(150_000)
  await w.waitFor(() => w.seen.cache != null && w.idle())
  expect(Object.keys(w.seen.cache?.resources ?? {}).length).toBe(0)
  expect(w.runs.filter(a => a[1] === 'rest').length).toBe(0)
})

test('u4 a resource Azure lists with no status at all is ok, not unknown (static sites, identities)', async () => {
  const base = DEMO_SUITE_ROWS.find(r => r.name === 'app-control') as GraphRow
  const quiet = { ...base, runningStatus: '', state: '', provisioningState: '', latestRevisionName: '', latestReadyRevisionName: '' }
  expect(rowToCard(quiet, NOW, 'group').status).toBe('ok')
  expect(rowToCard({ ...quiet, provisioningState: 'Updating' }, NOW, 'group').status).toBe('busy')
  expect(rowToCard({ ...quiet, state: 'Stopped' }, NOW, 'group').status).toBe('stopped')
})

test('u5 an empty list is no fact; a list of names reads as a list', async () => {
  const base = DEMO_SUITE_ROWS.find(r => r.name === 'app-control') as GraphRow
  const site = { ...base, type: 'microsoft.web/staticsites' }
  expect(rowToCard({ ...site, customDomains: '[]' }, NOW, 'group').facts.customDomains).toBeUndefined()
  expect(rowToCard({ ...site, customDomains: '["www.example.com","example.com"]' }, NOW, 'group').facts.customDomains)
    .toBe('www.example.com, example.com')
})

test('u7 a session moved to another folder scans it, though its old Scan was left in progress', async ($, on) => {
  // the desktop app keeps a spare session ready and moves it to the folder opened: the mod reloads,
  // but $.state keeps what the spare one left (a Scan "in progress" that will never end)
  // stale until the mod writes `busy` itself (the world records every write in w.seen)
  const w = startWorld(on)
  on('state.get', (_$, e, next) => (w.seen.busy === undefined && e.plugin === 'az-mod' && e.key === 'busy'
    ? { value: { value: { shape: 'busy-1', value: { scan: true, update: true, cost: true, ids: [] } }, version: 1 } }
    : next(e)))
  // ends only once the Scan adopted the project group and Azure was read
  await w.start($)
  expect(Object.keys(w.seen.rules?.groups ?? {})).toHaveLength(1)
})
