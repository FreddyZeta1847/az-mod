/*
 * cost.test.ts — tests of the cost reading (letter A of «Costi, attività e avvisi»): the
 * Cost Management query and its answer (cost.ts, pure), then the reading through the whole
 * mod over world.ts (twice a day, the button, an Azure refusal that never stops the rest).
 */
import { expect, test } from 'claude-code/testing'

import { costBody, costDue, parseCost } from './cost'
import { NOW } from './world'

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
