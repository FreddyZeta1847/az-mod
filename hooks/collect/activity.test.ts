/*
 * activity.test.ts — tests of the recent activities (letter B of «Costi, attività e avvisi»):
 * the activity-log call and its filter (activity.ts, pure: only real changes, one row per
 * action, nothing but four fields kept), then the reading through the whole mod over world.ts.
 */
import { expect, test } from 'claude-code/testing'

import { ACTIVITY_MAX, ACTIVITY_QUERY, activityArgs, activityDue, parseActivity } from './activity'
import { NOW } from './world'
import { SECRET_VALUE } from '../fixtures/azure'

const APP = '/subscriptions/0/resourceGroups/rg-demo-suite/providers/Microsoft.App/containerApps/app-control'
const iso = (minutesAgo: number): string => new Date(NOW - minutesAgo * 60_000).toISOString()
const ev = (op: string, status: string, minutesAgo: number, cid = `c-${op}-${minutesAgo}`, id = APP) =>
  ({ op, status, at: iso(minutesAgo), id, cid })

// ---------------------------------------------------------------- B1 call and filter

test('the call asks only named fields for a week', async () => {
  expect(activityArgs({ group: 'rg-demo-suite' })).toEqual(
    ['monitor', 'activity-log', 'list', '-g', 'rg-demo-suite', '--offset', '7d', '--query', ACTIVITY_QUERY])
  expect(activityArgs({ id: APP })).toEqual(
    ['monitor', 'activity-log', 'list', '--resource-id', APP, '--offset', '7d', '--query', ACTIVITY_QUERY])
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
