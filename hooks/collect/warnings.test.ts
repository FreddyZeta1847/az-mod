/*
 * warnings.test.ts — tests of the warnings (letter C of «Costi, attività e avvisi»): the cost
 * spike (month-to-date above 1.5 × last month), the warnings each card carries, and the
 * «Da guardare» rows (contract.ts: ordered by how serious, at most four, gone with their cause).
 */
import { expect, test } from 'claude-code/testing'

import { isCostSpike, warningsFor, watchList } from '../contract'
import { rowToCard } from './graph'
import { NOW } from './world'
import { DEMO_SUITE_ROWS } from '../fixtures/azure'
import type { GraphRow } from '../fixtures/azure'
import type { AzCard, AzWarning } from '../../types'

const card = (name: string, warnings: AzWarning[] = [], over: Partial<AzCard> = {}): AzCard => ({
  id: `/subscriptions/0/resourcegroups/rg-x/providers/microsoft.app/containerapps/${name}`, name,
  type: 'microsoft.app/containerapps', group: 'rg-x', location: 'westeurope', status: 'ok', autoCreated: false,
  via: 'group', facts: {}, uses: [], warnings, stateAt: NOW, ...over,
})
const rowOf = (name: string): GraphRow => DEMO_SUITE_ROWS.find(r => r.name === name) as GraphRow

test('cost spike only above one and a half times last month', async () => {
  expect(isCostSpike({ month: 16, prevMonth: 10 })).toBe(true)
  expect(isCostSpike({ month: 15, prevMonth: 10 })).toBe(false)
  expect(isCostSpike({ month: 50, prevMonth: null })).toBe(false)
  expect(isCostSpike({ month: 5, prevMonth: 0 })).toBe(false)
  expect(isCostSpike(undefined)).toBe(false)
  expect(warningsFor(card('a', [], { cost: { month: 40, prevMonth: 20 } }))).toEqual(['cost-spike'])
})

test('each warning comes from its data', async () => {
  expect(rowToCard(rowOf('app-flow'), NOW, 'group').warnings).toEqual(['revision-failed'])
  expect(rowToCard(rowOf('acrdemosuite'), NOW, 'group').warnings).toEqual(['registry-admin'])
  expect(rowToCard({ ...rowOf('app-control'), runningStatus: 'Stopped' }, NOW, 'group').warnings).toEqual(['app-stopped'])
  expect(rowToCard({ ...rowOf('kv-demo-suite'), purgeProtection: false }, NOW, 'group').warnings).toEqual(['kv-protection-off'])
  expect(rowToCard(rowOf('app-control'), NOW, 'group').warnings).toEqual([])
})

test('the list is ordered and stops at four', async () => {
  const cards = [
    card('z-registry', ['registry-admin']),
    card('b-spend', [], { cost: { month: 30, prevMonth: 10 } }),
    card('a-stopped', ['app-stopped']),
    card('c-vault', ['kv-protection-off']),
    card('d-failed', ['revision-failed']),
    card('e-fine'),
  ]
  const { rows, more } = watchList(cards)
  expect(rows.map(r => `${r.warning}:${r.name}`)).toEqual([
    'revision-failed:d-failed', 'app-stopped:a-stopped', 'cost-spike:b-spend', 'kv-protection-off:c-vault',
  ])
  expect(more).toBe(1)
  expect(watchList(cards, 10).more).toBe(0)
  expect(watchList([card('e-fine')]).rows).toEqual([])
})

test('a warning goes when its cause goes', async () => {
  const failed = rowToCard(rowOf('app-flow'), NOW, 'group')
  expect(watchList([failed]).rows).toHaveLength(1)
  const fixed = rowToCard({ ...rowOf('app-flow'), latestReadyRevisionName: rowOf('app-flow').latestRevisionName }, NOW, 'group')
  expect(watchList([fixed]).rows).toHaveLength(0)
  // a resource gone from Azure is no longer something to look at
  expect(watchList([{ ...failed, goneAt: NOW }]).rows).toHaveLength(0)
  expect(watchList([card('b', [], { cost: { month: 10, prevMonth: 10 } })]).rows).toHaveLength(0)
})
