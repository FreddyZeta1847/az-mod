/*
 * activity.ts — the recent activities of the project, as pure pieces: the activity-log call
 * (one per group, or per resource included from elsewhere; a week; named fields only) and
 * the filter that keeps only real changes (write, delete, start/stop/restart…), one row
 * per action, newest first, at most ACTIVITY_MAX, and only four fields: time, operation,
 * outcome, resource. Never the request, the caller or the claims.
 * actions.ts runs the calls and writes the result into the cache.
 */
import type { AzActivity, AzId } from '../../types'

export const ACTIVITY_MS = 15 * 60_000
export const ACTIVITY_OPEN_MS = 2 * 60_000
export const ACTIVITY_MAX = 30
const WEEK_MS = 7 * 24 * 3_600_000

/** The activity loop's own memory: one read at a time, and a refusal never delays the state Update. */
export const activityLoop = { backoffUntil: 0, isReading: false }

export const ACTIVITY_QUERY = '[].{op:operationName.value,status:status.value,at:eventTimestamp,id:resourceId,cid:correlationId}'

/** Azure answers 50 events by default, most of them noise (tokens, keys): ask for a whole week of a busy group. */
export const ACTIVITY_EVENTS = 1000

export const activityArgs = (target: { group: string } | { id: AzId }, subId: string): string[] => [
  'monitor', 'activity-log', 'list',
  ...('group' in target ? ['-g', target.group] : ['--resource-id', target.id]),
  '--subscription', subId, '--offset', '7d', '--max-events', String(ACTIVITY_EVENTS), '--query', ACTIVITY_QUERY,
]

const CHANGE = /\/(write|delete)$|\/(start|stop|restart|deploy|activate)\/action$/
const NOISE = /^microsoft\.(advisor|authorization)\/|\/read$|getauthtoken|listkeys|listsecrets/
/** How final an outcome is: Container Apps changes end as Accepted (no Succeeded event follows). */
const RANK: Record<string, number> = { succeeded: 2, failed: 2, accepted: 1 }

type Row = { op?: unknown; status?: unknown; at?: unknown; id?: unknown; cid?: unknown }

/** One row per action (correlation, operation, resource): Succeeded/Failed win over Accepted; Started alone is dropped. */
export const parseActivity = (rows: unknown, now: number): AzActivity[] => {
  if (!Array.isArray(rows)) return []
  const byAction = new Map<string, AzActivity>()
  for (const r of rows as Row[]) {
    const op = String(r?.op ?? '').toLowerCase()
    const status = String(r?.status ?? '')
    const at = Date.parse(String(r?.at ?? ''))
    const resourceId = String(r?.id ?? '').toLowerCase()
    const rank = RANK[status.toLowerCase()] ?? 0
    if (!CHANGE.test(op) || NOISE.test(op) || rank === 0) continue
    if (!Number.isFinite(at) || now - at > WEEK_MS || resourceId === '') continue
    const key = `${String(r?.cid ?? at)}|${op}|${resourceId}`
    const old = byAction.get(key)
    const oldRank = old === undefined ? 0 : RANK[old.status.toLowerCase()] ?? 0
    if (old === undefined || rank > oldRank || (rank === oldRank && at > old.at)) byAction.set(key, { at, op, status, resourceId })
  }
  return [...byAction.values()].sort((a, b) => b.at - a.at).slice(0, ACTIVITY_MAX)
}

export const activityDue = (now: number, activityAt: number | undefined, isOpening: boolean): boolean =>
  activityAt === undefined || now - activityAt >= (isOpening ? ACTIVITY_OPEN_MS : ACTIVITY_MS)
