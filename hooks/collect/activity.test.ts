/*
 * activity.test.ts — tests of the recent activities (letter B of «Costi, attività e avvisi»):
 * the activity-log call and its filter (activity.ts, pure: only real changes, one row per
 * action, nothing but four fields kept), then the reading through the whole mod over world.ts.
 */
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ACTIVITY_MAX, ACTIVITY_QUERY, activityArgs, activityDue, parseActivity } from './activity'
import { NOW, result, ROOT, startWorld } from './world'
import type { World } from './world'
import { DEMO_SUITE_ROWS, gid, rid, SECRET_VALUE } from '../fixtures/azure'
import type { AzRules } from '../../types'

const APP = '/subscriptions/0/resourceGroups/rg-demo-suite/providers/Microsoft.App/containerApps/app-control'
const iso = (minutesAgo: number): string => new Date(NOW - minutesAgo * 60_000).toISOString()
const ev = (op: string, status: string, minutesAgo: number, cid = `c-${op}-${minutesAgo}`, id = APP) =>
  ({ op, status, at: iso(minutesAgo), id, cid })

// ---------------------------------------------------------------- B1 call and filter

test('the call asks only named fields for a week', async () => {
  // k1: 50 events by default, most of them noise; k12: the subscription the photo belongs to
  const tail = ['--subscription', 'sub-1', '--offset', '7d', '--max-events', '1000', '--query', ACTIVITY_QUERY]
  expect(activityArgs({ group: 'rg-demo-suite' }, 'sub-1')).toEqual(['monitor', 'activity-log', 'list', '-g', 'rg-demo-suite', ...tail])
  expect(activityArgs({ id: APP }, 'sub-1')).toEqual(['monitor', 'activity-log', 'list', '--resource-id', APP, ...tail])
  expect(ACTIVITY_QUERY.includes('properties')).toBe(false)
  expect(ACTIVITY_QUERY.includes('claims')).toBe(false)
})

test('only real changes are kept', async () => {
  const rows = [
    ev('Microsoft.App/containerApps/write', 'Succeeded', 10),
    ev('Microsoft.App/containerApps/delete', 'Failed', 20),
    ev('Microsoft.App/containerApps/revisions/restart/action', 'Succeeded', 30),
    ev('Microsoft.Web/sites/stop/action', 'Succeeded', 40),
    ev('Microsoft.App/containerApps/getAuthToken/action', 'Succeeded', 1),
    ev('Microsoft.Storage/storageAccounts/listKeys/action', 'Succeeded', 2),
    ev('Microsoft.KeyVault/vaults/secrets/read', 'Succeeded', 3),
    ev('Microsoft.Advisor/recommendations/available/action', 'Active', 4),
    ev('Microsoft.Authorization/locks/write', 'Succeeded', 5),
  ]
  const kept = parseActivity(rows, NOW)
  expect(kept.map(a => a.op)).toEqual([
    'microsoft.app/containerapps/write', 'microsoft.app/containerapps/delete',
    'microsoft.app/containerapps/revisions/restart/action', 'microsoft.web/sites/stop/action',
  ])
  expect(kept[0]).toEqual({ at: NOW - 10 * 60_000, op: 'microsoft.app/containerapps/write', status: 'Succeeded', resourceId: APP.toLowerCase() })
})

test('started and succeeded become one row', async () => {
  const kept = parseActivity([
    ev('Microsoft.App/containerApps/write', 'Started', 12, 'c1'),
    ev('Microsoft.App/containerApps/write', 'Accepted', 11, 'c1'),
    ev('Microsoft.App/containerApps/write', 'Succeeded', 10, 'c1'),
    ev('Microsoft.App/containerApps/write', 'Started', 5, 'c2'),
  ], NOW)
  expect(kept).toHaveLength(1)
  expect(kept[0]?.status).toBe('Succeeded')
  expect(kept[0]?.at).toBe(NOW - 10 * 60_000)
})

test('k2 container app changes end as Accepted and are kept', async () => {
  const kept = parseActivity([
    ev('Microsoft.App/containerApps/write', 'Started', 12, 'c1'),
    ev('Microsoft.App/containerApps/write', 'Accepted', 11, 'c1'),
    ev('Microsoft.App/containerApps/write', 'Started', 5, 'c2'),
    ev('Microsoft.Resources/deployments/write', 'Accepted', 9, 'c3'),
    ev('Microsoft.Resources/deployments/write', 'Succeeded', 8, 'c3'),
  ], NOW)
  expect(kept.map(a => `${a.op}:${a.status}`)).toEqual(['microsoft.resources/deployments/write:Succeeded', 'microsoft.app/containerapps/write:Accepted'])
})

test('noise and duplicates go, at most 30 rows', async () => {
  const many = Array.from({ length: 200 }, (_, i) => ev('Microsoft.App/containerApps/write', 'Succeeded', i + 1))
  const noise = Array.from({ length: 300 }, (_, i) => ev('Microsoft.App/containerApps/getAuthToken/action', 'Succeeded', i))
  const kept = parseActivity([...noise, ...many], NOW)
  expect(kept).toHaveLength(ACTIVITY_MAX)
  expect(ACTIVITY_MAX).toBe(30)
  expect(kept[0]?.at).toBe(NOW - 60_000)
  expect(kept.every((a, i) => i === 0 || (kept[i - 1]?.at ?? 0) >= a.at)).toBe(true)
  // older than a week: gone
  expect(parseActivity([ev('Microsoft.App/containerApps/write', 'Succeeded', 8 * 24 * 60)], NOW)).toHaveLength(0)
  expect(parseActivity('not a list', NOW)).toEqual([])
})

test('nothing but the four fields is kept', async () => {
  const leaky = { ...ev('Microsoft.App/containerApps/write', 'Succeeded', 3), claims: { upn: 'someone@example.com' },
    httpRequest: { clientIpAddress: '10.0.0.1' }, properties: { requestbody: SECRET_VALUE } }
  const kept = parseActivity([leaky], NOW)
  expect(Object.keys(kept[0] ?? {}).sort()).toEqual(['at', 'op', 'resourceId', 'status'])
  const text = JSON.stringify(kept)
  expect(text.includes(SECRET_VALUE)).toBe(false)
  expect(text.includes('someone@example.com')).toBe(false)
  expect(text.includes('10.0.0.1')).toBe(false)
})

test('activity rhythm', async () => {
  expect(activityDue(NOW, undefined, false)).toBe(true)
  expect(activityDue(NOW, NOW - 14 * 60_000, false)).toBe(false)
  expect(activityDue(NOW, NOW - 15 * 60_000, false)).toBe(true)
  expect(activityDue(NOW, NOW - 60_000, true)).toBe(false)
  expect(activityDue(NOW, NOW - 2 * 60_000, true)).toBe(true)
})

// ---------------------------------------------------------------- B2 through the mod

const PANE = {
  plugin: 'az-mod', component: 'Pane', requestId: 'az-mod', surface: 'desktop',
  props: { title: 'Azure', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const isActivity = (a: string[]): boolean => a[1] === 'monitor' && a[2] === 'activity-log'
const isGraph = (a: string[]): boolean => a[1] === 'rest' && a.some(x => x.includes('Microsoft.ResourceGraph/resources'))
const activityCalls = (w: World): string[][] => w.runs.filter(isActivity)
const OTHER = rid('rg-other', 'microsoft.app/containerapps', 'other-api')

/** Saved rules (demo group + one resource from another group): no first Scan, the first read waits a tick. */
async function startSaved($: Engine, w: World): Promise<void> {
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(30_000)
  await w.waitFor(() => Object.keys(w.seen.cache?.resources ?? {}).length > 0 && w.idle())
}
const savedRules = (): Record<string, string> => {
  const rules: AzRules = {
    schemaVersion: 1, project: { key: 'demo-suite', mainRoot: ROOT, remote: null },
    groups: { [gid('rg-demo-suite')]: { at: 1 } }, includes: { [OTHER]: { at: 1 } }, excludes: {}, dismissed: {}, updatedAt: 1,
  }
  return { '/data/projects/demo-suite.rules.json': JSON.stringify(rules) }
}

test('activities are read for every group and include', async ($, on) => {
  const w = startWorld(on, { files: savedRules() })
  await startSaved($, w)
  await w.clock.advance(30_000)
  await w.waitFor(() => w.seen.cache?.activityAt !== undefined)
  const calls = activityCalls(w)
  expect(calls.some(a => a.includes('-g') && a.includes('rg-demo-suite'))).toBe(true)
  expect(calls.some(a => a.includes('--resource-id') && a.includes(OTHER))).toBe(true)
  expect(calls).toHaveLength(2)
  const kept = w.seen.cache?.activity ?? []
  expect(kept.map(a => a.op)).toEqual([
    'microsoft.app/containerapps/revisions/restart/action', 'microsoft.app/containerapps/write', 'microsoft.storage/storageaccounts/delete',
  ])
})

test('opening a card reads them when older than two minutes', async ($, on) => {
  const w = startWorld(on, { files: savedRules() })
  await startSaved($, w)
  await w.clock.advance(30_000)
  await w.waitFor(() => w.seen.cache?.activityAt !== undefined && w.idle())
  const before = activityCalls(w).length
  const ui = await $.ui.mount(PANE)
  const card = DEMO_SUITE_ROWS.find(r => r.name === 'app-control')?.id as string
  await ui.press({ key: `open-${card}` }) // opens: read less than 2 min ago, nothing
  await ui.press({ key: `open-${card}` }) // closes
  await w.pause(50)
  expect(activityCalls(w).length).toBe(before)
  await w.clock.advance(150_000)
  await ui.press({ key: `open-${card}` }) // opens: older than 2 min, read again
  await w.waitFor(() => activityCalls(w).length > before && w.idle())
  const opened = activityCalls(w).length
  await w.clock.advance(150_000)
  await ui.press({ key: `open-${card}` }) // k8: closing reads nothing
  await w.pause(50)
  expect(activityCalls(w).length).toBe(opened)
  await ui.unmount()
})

test('an activity error never stops the state update', async ($, on) => {
  const w = startWorld(on, { files: savedRules(), az: a => (isActivity(a) ? result(1, '', 'ERROR: getaddrinfo ENOTFOUND management.azure.com') : undefined) })
  await startSaved($, w)
  await w.clock.advance(30_000)
  await w.waitFor(() => w.seen.cache?.errors.activity !== undefined && w.idle())
  expect(w.seen.cache?.errors.activity?.code).toBe('network')
  expect(w.seen.health?.az).toBe('ok')
  w.runs.length = 0
  await w.clock.advance(120_000)
  await w.waitFor(() => w.runs.some(isGraph))
})

test('k7 one target that cannot be read does not hide the others', async ($, on) => {
  const w = startWorld(on, { files: savedRules(), az: a => (isActivity(a) && a.includes('--resource-id') ? result(1, '', 'ERROR: (AuthorizationFailed) no access') : undefined) })
  await startSaved($, w)
  await w.clock.advance(30_000)
  await w.waitFor(() => w.seen.cache?.activityAt !== undefined && w.idle())
  expect(w.seen.cache?.activity.length).toBe(3)
  expect(w.seen.cache?.errors.activity?.code).toBe('forbidden')
})
