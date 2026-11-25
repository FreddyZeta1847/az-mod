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

export const activityArgs = (target: { group: string } | { id: AzId }): string[] => [
  'monitor', 'activity-log', 'list',
  ...('group' in target ? ['-g', target.group] : ['--resource-id', target.id]),
  '--offset', '7d', '--query', ACTIVITY_QUERY,
]

const CHANGE = /\/(write|delete)$|\/(start|stop|restart|deploy|activate)\/action$/
const NOISE = /^microsoft\.(advisor|authorization)\/|\/read$|getauthtoken|listkeys|listsecrets/
const FINAL = new Set(['succeeded', 'failed'])

type Row = { op?: unknown; status?: unknown; at?: unknown; id?: unknown; cid?: unknown }

/** One row per action (correlation, operation, resource): the final outcome wins over Started/Accepted. */
export const parseActivity = (rows: unknown, now: number): AzActivity[] => {
  if (!Array.isArray(rows)) return []
  const byAction = new Map<string, AzActivity>()
  for (const r of rows as Row[]) {
    const op = String(r?.op ?? '').toLowerCase()
    const status = String(r?.status ?? '')
    const at = Date.parse(String(r?.at ?? ''))
    const resourceId = String(r?.id ?? '').toLowerCase()
    if (!CHANGE.test(op) || NOISE.test(op) || !FINAL.has(status.toLowerCase())) continue
    if (!Number.isFinite(at) || now - at > WEEK_MS || resourceId === '') continue
    const key = `${String(r?.cid ?? at)}|${op}|${resourceId}`
    const old = byAction.get(key)
    if (old === undefined || at > old.at) byAction.set(key, { at, op, status, resourceId })
  }
  return [...byAction.values()].sort((a, b) => b.at - a.at).slice(0, ACTIVITY_MAX)
}

export const activityDue = (now: number, activityAt: number | undefined, isOpening: boolean): boolean =>
  activityAt === undefined || now - activityAt >= (isOpening ? ACTIVITY_OPEN_MS : ACTIVITY_MS)
