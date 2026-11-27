/*
 * refresh.ts — the rhythm of the automatic Update, as pure decisions plus the loop's
 * memory: every 2 minutes while the pane is placed, every 10 after 30 minutes without
 * input, nothing while the pane is closed; after an error wait 2, 4, 8, 16, then 30
 * minutes (or longer when Azure asks); an expired login stops the loop until a button
 * press. The timer itself lives in actions.ts (startLoop), which calls these.
 */
import type { AzCache, AzError } from '../../types'

export const TICK_MS = 30_000
const ACTIVE_MS = 120_000
const IDLE_MS = 600_000
const IDLE_AFTER_MS = 1_800_000
const BACKOFF_MIN = [2, 4, 8, 16, 30]

export const intervalFor = (now: number, lastInputAt: number): number =>
  now - lastInputAt > IDLE_AFTER_MS ? IDLE_MS : ACTIVE_MS

export const backoffMs = (failures: number): number =>
  (BACKOFF_MIN[Math.min(Math.max(failures, 1), BACKOFF_MIN.length) - 1] as number) * 60_000

type TickState = {
  now: number; placed: boolean; lastInputAt: number; stateAt: number | undefined
  backoffUntil: number; isLoginStopped: boolean
}

export const shouldRefresh = (s: TickState): boolean =>
  s.placed && !s.isLoginStopped && s.now >= s.backoffUntil &&
  (s.stateAt === undefined || s.now - s.stateAt >= intervalFor(s.now, s.lastInputAt))

/** The cache to fill for this subscription: the same one, or a fresh one when az now points elsewhere. */
export const cacheForSubscription = (cache: AzCache | null, sub: { id: string; name: string }, key: string): AzCache =>
  cache !== null && cache.subscription.id === sub.id && cache.projectKey === key
    ? { ...cache, subscription: sub }
    : { schemaVersion: 1, projectKey: key, subscription: sub, groups: {}, resources: {}, activity: [], errors: {} }

/** A change for the photo of `subId` only: a photo of another subscription (az account set meanwhile) stays as it is. */
export const forSubscription = (subId: string, patch: (c: AzCache) => AzCache) => (c: AzCache | null): AzCache | null =>
  c === null || c.subscription.id !== subId ? c : patch(c)

/**
 * The error a part keeps after two photos meet: the newest one, and only when it came after the
 * newest data (a read that worked later means the error is over).
 */
const errorAfter = (a: AzError | undefined, b: AzError | undefined, newestData: number): AzError | undefined => {
  const newest = a === undefined ? b : b === undefined ? a : b.at > a.at ? b : a
  // `>=`: a target refused during a read that kept the others has the same time as that read
  return newest !== undefined && newest.at >= newestData ? newest : undefined
}

/** `errors` with `kind` set to `error`, or without it. */
const withError = (errors: AzCache['errors'], kind: 'cost' | 'activity', error: AzError | undefined): AzCache['errors'] => {
  const { [kind]: _old, ...rest } = errors
  return error === undefined ? rest : { ...rest, [kind]: error }
}

/**
 * `next` with the costs and the activities of `other` when those were read later (another write
 * landed meanwhile, or another session saved them); each part's data goes by the time it was read,
 * its error by `errorAfter`, so a newer error never brings back older data. Another subscription
 * or project: `next` as is. Returns `next` itself when nothing changes.
 */
export const keepNewerReads = (next: AzCache, other: AzCache | null): AzCache => {
  if (other === null || other.subscription.id !== next.subscription.id || other.projectKey !== next.projectKey) return next
  let out = next
  const costNewer = (other.costAt ?? -1) > (out.costAt ?? -1)
  const costError = errorAfter(out.errors.cost, other.errors.cost, Math.max(out.costAt ?? -1, other.costAt ?? -1))
  if (costNewer || costError !== out.errors.cost) {
    out = { ...out, errors: withError(out.errors, 'cost', costError) }
    if (costNewer) {
      out.resources = Object.fromEntries(Object.entries(out.resources).map(([id, card]) => {
        const cost = other.resources[id]?.cost
        return [id, cost === undefined ? card : { ...card, cost }]
      }))
      if (other.cost !== undefined) out.cost = other.cost
      if (other.costAt !== undefined) out.costAt = other.costAt
    }
  }
  const activityNewer = (other.activityAt ?? -1) > (out.activityAt ?? -1)
  const activityError = errorAfter(out.errors.activity, other.errors.activity, Math.max(out.activityAt ?? -1, other.activityAt ?? -1))
  if (activityNewer || activityError !== out.errors.activity) {
    out = { ...out, errors: withError(out.errors, 'activity', activityError) }
    if (activityNewer) {
      out.activity = other.activity
      if (other.activityAt !== undefined) out.activityAt = other.activityAt
    }
  }
  return out
}

/** The loop's memory for this module load (a reload starts over, as the timer does). */
export const loop = { failures: 0, backoffUntil: 0, isLoginStopped: false, startedAt: 0, cancel: undefined as (() => void) | undefined }

export const noteSuccess = (): void => {
  loop.failures = 0
  loop.backoffUntil = 0
}

export const noteError = (error: AzError, now: number): void => {
  if (error.code === 'login') {
    loop.isLoginStopped = true
    return
  }
  loop.failures += 1
  loop.backoffUntil = Math.max(now + backoffMs(loop.failures), error.retryAt ?? 0)
}

/** A button press restarts the automatic Update after a login stop or a backoff. */
export const resume = (): void => {
  loop.isLoginStopped = false
  loop.backoffUntil = 0
}
