/*
 * cost.test.ts — tests of the cost reading (letter A of «Costi, attività e avvisi»): the
 * Cost Management query and its answer (cost.ts, pure), then the reading through the whole
 * mod over world.ts (twice a day, an Azure refusal that never stops the rest, resources
 * added from another group). The cost button is tested with the pane (extras.test.tsx).
 */
import { expect, test } from 'claude-code/testing'

import { costBody, costDue, parseCost } from './cost'
import { NOW, result, ROOT, startWorld } from './world'
import type { World } from './world'
import { DEMO_SUITE_ROWS, rid, SUB } from '../fixtures/azure'
import type { AzRules } from '../../types'

const R1 = '/subscriptions/0/resourcegroups/rg-demo-suite/providers/microsoft.app/containerapps/app-control'
const R2 = '/subscriptions/0/resourcegroups/rg-demo-suite/providers/microsoft.storage/storageaccounts/stdemo'
const THIS_MONTH = new Date(NOW).toISOString().slice(0, 7)
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
  expect(THIS_MONTH.length).toBe(7)
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
