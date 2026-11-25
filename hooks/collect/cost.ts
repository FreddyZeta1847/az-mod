/*
 * cost.ts — the month's cost of the project's resources, as pure pieces: the Cost Management
 * query (one call: from the first day of last month to now, by resource and month), its
 * answer turned into this month and last month per resource, and the rhythm (every 12 h).
 * actions.ts runs it (body in a file, `az rest`) and writes the result into the cache.
 * Columns are found by name: Cost, BillingMonth, ResourceId, Currency.
 */
import type { AzCost, AzId } from '../../types'

export const COST_MS = 12 * 3_600_000

/** The cost loop's own memory: a refusal of the cost API never delays the state Update. */
export const costLoop = { backoffUntil: 0 }

export const costUrl = (subId: string): string =>
  `https://management.azure.com/subscriptions/${subId}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`

/** First day (UTC) of the month `offset` months from `now`'s, as ms. */
const monthStart = (now: number, offset: number): number => {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)
}

const dimension = (name: string, values: string[]) => ({ dimensions: { name, operator: 'In', values } })

export const costBody = (groupNames: string[], ids: AzId[], now: number): object => {
  const filters = [
    ...(groupNames.length > 0 ? [dimension('ResourceGroupName', groupNames.map(g => g.toLowerCase()))] : []),
    ...(ids.length > 0 ? [dimension('ResourceId', ids.map(i => i.toLowerCase()))] : []),
  ]
  return {
    type: 'ActualCost',
    timeframe: 'Custom',
    timePeriod: { from: new Date(monthStart(now, -1)).toISOString(), to: new Date(now).toISOString() },
    dataset: {
      granularity: 'Monthly',
      aggregation: { cost: { name: 'Cost', function: 'Sum' } },
      grouping: [{ type: 'Dimension', name: 'ResourceId' }],
      filter: filters.length === 1 ? filters[0] : { or: filters },
    },
  }
}

export type CostRead = { currency: string; byId: Record<AzId, AzCost>; total: AzCost }

type Answer = { properties?: { columns?: { name?: unknown }[]; rows?: unknown[][] } }

/** This month → `month`, last month → `prevMonth` (null when Azure has no row for it). */
export const parseCost = (answer: unknown, now: number): CostRead => {
  const p = (answer as Answer | null)?.properties
  const names = (p?.columns ?? []).map(c => String(c.name))
  const col = (n: string): number => names.indexOf(n)
  const [iCost, iMonth, iId, iCur] = [col('Cost'), col('BillingMonth'), col('ResourceId'), col('Currency')]
  const thisMonth = monthStart(now, 0)
  const lastMonth = monthStart(now, -1)
  const byId: Record<AzId, AzCost> = {}
  let currency = 'EUR'
  for (const row of Array.isArray(p?.rows) ? p.rows : []) {
    const id = String(row[iId] ?? '').toLowerCase()
    const cost = Number(row[iCost])
    const at = Date.parse(`${String(row[iMonth]).slice(0, 19)}Z`)
    if (id === '' || !Number.isFinite(cost)) continue
    if (typeof row[iCur] === 'string' && row[iCur] !== '') currency = row[iCur] as string
    const c = byId[id] ?? { month: 0, prevMonth: null }
    if (at >= thisMonth) c.month += cost
    else if (at >= lastMonth) c.prevMonth = (c.prevMonth ?? 0) + cost
    byId[id] = c
  }
  const all = Object.values(byId)
  const withPrev = all.filter(c => c.prevMonth !== null)
  const total: AzCost = {
    month: all.reduce((s, c) => s + c.month, 0),
    prevMonth: withPrev.length === 0 ? null : withPrev.reduce((s, c) => s + (c.prevMonth ?? 0), 0),
  }
  return { currency, byId, total }
}

export const costDue = (now: number, costAt: number | undefined): boolean =>
  costAt === undefined || now - costAt >= COST_MS
