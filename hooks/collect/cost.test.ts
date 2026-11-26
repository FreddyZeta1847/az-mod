/*
 * cost.test.ts — tests of the cost reading (letter A of «Costi, attività e avvisi»): the
 * Cost Management query and its answer (cost.ts, pure), then the reading through the whole
 * mod over world.ts (twice a day, an Azure refusal that never stops the rest, resources
 * added from another group). The cost button is tested with the pane (extras.test.tsx).
 */
import { expect, test } from 'claude-code/testing'

import { costBody, costDue, parseCost } from './cost'
import { keepNewerReads } from './refresh'
import { NOW, result, ROOT, startWorld } from './world'
import type { World } from './world'
import { DEMO_SUITE_ROWS, rid, SUB } from '../fixtures/azure'
import type { AzCache, AzCard, AzRules } from '../../types'

const R1 = '/subscriptions/0/resourcegroups/rg-demo-suite/providers/microsoft.app/containerapps/app-control'
const R2 = '/subscriptions/0/resourcegroups/rg-demo-suite/providers/microsoft.storage/storageaccounts/stdemo'
const firstOf = (offset: number): string => {
  const d = new Date(NOW)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)).toISOString().slice(0, 19)
}
const answer = (rows: unknown[][], order = ['Cost', 'BillingMonth', 'ResourceId', 'Currency']) => ({
  properties: { columns: order.map(name => ({ name, type: 'String' })), rows, nextLink: null },
})

// ---------------------------------------------------------------- A1 query and answer

test('cost body asks two months by resource for the groups', async () => {
  const b = costBody(['RG-Demo-Suite'], [], NOW) as Record<string, any>
  expect(b.type).toBe('ActualCost')
  expect(b.timeframe).toBe('Custom')
  expect(String(b.timePeriod.from).slice(0, 19)).toBe(firstOf(-1))
  expect(b.dataset.granularity).toBe('Monthly')
  expect(b.dataset.grouping).toEqual([{ type: 'Dimension', name: 'ResourceId' }])
  expect(b.dataset.filter).toEqual({ dimensions: { name: 'ResourceGroupName', operator: 'In', values: ['rg-demo-suite'] } })
  const withIds = costBody(['rg-demo-suite'], [R2], NOW) as Record<string, any>
  expect(withIds.dataset.filter.or).toEqual([
    { dimensions: { name: 'ResourceGroupName', operator: 'In', values: ['rg-demo-suite'] } },
    { dimensions: { name: 'ResourceId', operator: 'In', values: [R2] } },
  ])
  const onlyIds = costBody([], [R2], NOW) as Record<string, any>
  expect(onlyIds.dataset.filter).toEqual({ dimensions: { name: 'ResourceId', operator: 'In', values: [R2] } })
})

test('answer becomes month and previous month per resource', async () => {
  const rows = [
    [10, `${firstOf(0)}`, R1.toUpperCase(), 'EUR'],
    [4, `${firstOf(-1)}`, R1, 'EUR'],
    [2.5, `${firstOf(0)}`, R2, 'EUR'],
  ]
  const r = parseCost(answer(rows), NOW)
  expect(r.currency).toBe('EUR')
  expect(r.byId[R1]).toEqual({ month: 10, prevMonth: 4 })
  expect(r.byId[R2]).toEqual({ month: 2.5, prevMonth: null })
  expect(r.total).toEqual({ month: 12.5, prevMonth: 4 })
  // the columns are found by name, not by place
  const shuffled = parseCost(answer(rows.map(([c, m, id, cur]) => [id, cur, c, m]), ['ResourceId', 'Currency', 'Cost', 'BillingMonth']), NOW)
  expect(shuffled.byId[R1]).toEqual({ month: 10, prevMonth: 4 })
})

test('no row this month is zero, not missing', async () => {
  const r = parseCost(answer([[3, `${firstOf(-1)}`, R1, 'EUR']]), NOW)
  expect(r.byId[R1]).toEqual({ month: 0, prevMonth: 3 })
  expect(r.total).toEqual({ month: 0, prevMonth: 3 })
  const empty = parseCost(answer([]), NOW)
  expect(empty.total).toEqual({ month: 0, prevMonth: null })
  expect(parseCost(null, NOW).byId).toEqual({})
})

test('currency comes from the answer', async () => {
  expect(parseCost(answer([[1, `${firstOf(0)}`, R1, 'USD']]), NOW).currency).toBe('USD')
  expect(parseCost(answer([]), NOW).currency).toBe('EUR')
})

test('costDue twice a day', async () => {
  expect(costDue(NOW, undefined)).toBe(true)
  expect(costDue(NOW, NOW - 11 * 3_600_000)).toBe(false)
  expect(costDue(NOW, NOW - 12 * 3_600_000)).toBe(true)
})

// ---------------------------------------------------------------- A2 through the mod

const isCost = (a: string[]): boolean => a[1] === 'rest' && a.some(x => x.includes('Microsoft.CostManagement/query'))
const isGraph = (a: string[]): boolean => a[1] === 'rest' && a.some(x => x.includes('Microsoft.ResourceGraph/resources'))
const costCalls = (w: World): number => w.runs.filter(isCost).length
const idOf = (name: string): string => DEMO_SUITE_ROWS.find(r => r.name === name)?.id as string

test('costs are read once and kept on every card', async ($, on) => {
  const w = startWorld(on)
  await w.start($)
  await w.clock.advance(30_000)
  await w.waitFor(() => w.seen.cache?.costAt !== undefined && w.idle())
  expect(costCalls(w)).toBe(1)
  const cache = w.seen.cache
  expect(cache?.cost).toEqual({ currency: 'EUR', month: 83.5, prevMonth: 48 })
  expect(cache?.resources[idOf('app-match')]?.cost).toEqual({ month: 40, prevMonth: 20 })
  expect(cache?.resources[idOf('kv-demo-suite')]?.cost).toEqual({ month: 0, prevMonth: null })
  expect(Object.values(cache?.resources ?? {}).every(c => c.cost !== undefined)).toBe(true)
})

/** A saved photo whose costs were read `hoursAgo` hours before the test clock. */
const photoWithCosts = (hoursAgo: number): Record<string, string> => ({
  '/data/projects/demo-suite.cache.json': JSON.stringify({
    schemaVersion: 1, projectKey: 'demo-suite', subscription: SUB, groups: {}, resources: {}, activity: [], errors: {},
    cost: { currency: 'EUR', month: 1, prevMonth: null }, costAt: NOW - hoursAgo * 3_600_000,
  }),
})

test('costs wait twelve hours', async ($, on) => {
  const w = startWorld(on, { files: photoWithCosts(11) })
  await w.start($)
  await w.clock.advance(30_000)
  await w.pause(50)
  expect(costCalls(w)).toBe(0)
  expect(w.seen.cache?.cost?.month).toBe(1)
})

test('costs older than twelve hours are read again', async ($, on) => {
  const w = startWorld(on, { files: photoWithCosts(12) })
  await w.start($)
  await w.clock.advance(30_000)
  await w.waitFor(() => costCalls(w) === 1 && w.idle())
})

test('a cost 429 never stops the state update', async ($, on) => {
  const w = startWorld(on, { az: a => (isCost(a) ? result(1, '', 'ERROR: (429) Too many requests. Retry-After: 60') : undefined) })
  await w.start($)
  await w.clock.advance(30_000)
  await w.waitFor(() => w.seen.cache?.errors.cost !== undefined && w.idle())
  expect(w.seen.cache?.errors.cost?.code).toBe('throttled')
  expect(w.seen.health?.az).toBe('ok')
  w.runs.length = 0
  await w.clock.advance(30_000)
  await w.pause(50)
  expect(costCalls(w)).toBe(0)
  await w.clock.advance(120_000)
  await w.waitFor(() => w.runs.some(isGraph) && costCalls(w) >= 1)
})

test('costs of a resource added from another group are asked by id', async ($, on) => {
  const other = rid('rg-other', 'microsoft.app/containerapps', 'other-api')
  const saved: AzRules = {
    schemaVersion: 1, project: { key: 'demo-suite', mainRoot: ROOT, remote: null },
    groups: { [idOf('app-control').split('/providers/')[0] as string]: { at: 1 } }, includes: { [other]: { at: 1 } },
    excludes: {}, dismissed: {}, updatedAt: 1,
  }
  const w = startWorld(on, { files: { '/data/projects/demo-suite.rules.json': JSON.stringify(saved) } })
  // saved rules: no first Scan, the first read of Azure waits for the first tick
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(30_000)
  await w.waitFor(() => Object.keys(w.seen.cache?.resources ?? {}).length > 0 && w.idle())
  await w.clock.advance(30_000)
  await w.waitFor(() => costCalls(w) === 1 && w.idle())
  const body = [...w.files.entries()].find(([k]) => k.includes('cost'))?.[1] ?? ''
  expect(body.includes('"ResourceId"')).toBe(true)
  expect(body.includes(other)).toBe(true)
  expect(body.includes('rg-demo-suite')).toBe(true)
})

// ---------------------------------------------------------------- review round 1 (k3, k6, k10)

const photo = (over: Partial<AzCache> = {}): AzCache => ({
  schemaVersion: 1, projectKey: 'demo-suite', subscription: SUB, groups: {}, activity: [], errors: {},
  resources: { [R1]: { id: R1, name: 'app-control', type: 'microsoft.app/containerapps', group: 'rg-demo-suite', location: 'westeurope',
    status: 'ok', autoCreated: false, via: 'group', facts: {}, uses: [], warnings: [], stateAt: NOW } },
  ...over,
})

test('k3 k6 a photo written later keeps costs and activities read meanwhile', async () => {
  const update = photo({ stateAt: NOW })
  const withReads = photo({
    stateAt: NOW - 120_000, costAt: NOW - 1_000, cost: { currency: 'EUR', month: 9, prevMonth: null },
    activityAt: NOW - 500, activity: [{ at: NOW - 600_000, op: 'microsoft.app/containerapps/write', status: 'Succeeded', resourceId: R1 }],
  })
  withReads.resources[R1] = { ...(withReads.resources[R1] as AzCard), cost: { month: 9, prevMonth: null } }
  const kept = keepNewerReads(update, withReads)
  expect(kept.stateAt).toBe(NOW)
  expect(kept.cost?.month).toBe(9)
  expect(kept.costAt).toBe(NOW - 1_000)
  expect(kept.resources[R1]?.cost).toEqual({ month: 9, prevMonth: null })
  expect(kept.activity).toHaveLength(1)
  // nothing newer: the same photo comes back
  expect(keepNewerReads(withReads, update)).toBe(withReads)
  // a newer failure of the cost read wins too
  const failed = photo({ errors: { cost: { at: NOW, code: 'throttled', message: 'busy' } } })
  expect(keepNewerReads(withReads, failed).errors.cost?.code).toBe('throttled')
  // another subscription or project is never mixed in
  expect(keepNewerReads(update, { ...withReads, subscription: { id: 'other', name: 'Other' } })).toBe(update)
  expect(keepNewerReads(update, { ...withReads, projectKey: 'other' })).toBe(update)
})

test('k10 no row keeps the currency read before', async () => {
  expect(parseCost(answer([]), NOW, 'USD').currency).toBe('USD')
  expect(parseCost(answer([[1, firstOf(0), R1, 'CHF']]), NOW, 'USD').currency).toBe('CHF')
})

test('k10 every page of the cost answer is read', async ($, on) => {
  const page2 = 'https://management.azure.com/subscriptions/x/providers/Microsoft.CostManagement/query?api-version=2023-11-01&$skiptoken=p2'
  const w = startWorld(on, {
    az: a => {
      if (!isCost(a)) return undefined
      const url = a[a.indexOf('--url') + 1] ?? ''
      const rows = url === page2 ? [[5, '2025-11-01T00:00:00', idOf('app-flow'), 'EUR']] : [[30, '2025-11-01T00:00:00', idOf('app-control'), 'EUR']]
      return result(0, JSON.stringify({ properties: { columns: ['Cost', 'BillingMonth', 'ResourceId', 'Currency'].map(name => ({ name })), rows, nextLink: url === page2 ? null : page2 } }))
    },
  })
  await w.start($)
  await w.clock.advance(30_000)
  await w.waitFor(() => w.seen.cache?.costAt !== undefined && w.idle())
  expect(costCalls(w)).toBe(2)
  expect(w.seen.cache?.cost?.month).toBe(35)
})
