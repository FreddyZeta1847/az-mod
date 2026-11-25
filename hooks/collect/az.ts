/*
 * az.ts — runs the Azure CLI for Raccolta (argv form, no shell) and sorts its failures:
 * missing (az cannot start), login, throttled (with Retry-After), network, forbidden,
 * other. An error keeps only the first stderr line, at most 200 characters: never stdout,
 * never the command's payload. Only the read calls listed in the plan are ever made.
 */
import type { EngineInterface } from 'claude-code'

import type { AzError } from '../../types'

export type AzRun = { ok: true; json: unknown } | { ok: false; error: AzError; missing?: true }

export const classifyError = (stderr: string, now: number): AzError => {
  const message = (stderr.split(/\r?\n/).find(l => l.trim() !== '') ?? 'az failed').trim().slice(0, 200)
  if (/az login|AADSTS70043|expired/i.test(stderr)) return { at: now, code: 'login', message }
  if (/429|throttl/i.test(stderr)) {
    const after = /Retry-After:?\s*(\d+)/i.exec(stderr)?.[1]
    return after === undefined
      ? { at: now, code: 'throttled', message }
      : { at: now, code: 'throttled', message, retryAt: now + Number(after) * 1000 }
  }
  if (/ENOTFOUND|getaddrinfo|timed out|ConnectionError/i.test(stderr)) return { at: now, code: 'network', message }
  if (/403|AuthorizationFailed/i.test(stderr)) return { at: now, code: 'forbidden', message }
  return { at: now, code: 'other', message }
}

export async function runAz($: EngineInterface, args: string[], timeoutMs = 60_000): Promise<AzRun> {
  const now = await $.clock.now()
  let r
  try {
    r = await $.process.run(['az', ...args], { timeoutMs })
  } catch {
    return { ok: false, missing: true, error: { at: now, code: 'other', message: 'az non trovato' } }
  }
  if (r.exitCode !== 0) return { ok: false, error: classifyError(r.stderr, now) }
  try {
    return { ok: true, json: JSON.parse(r.stdout) as unknown }
  } catch {
    return { ok: false, error: { at: now, code: 'other', message: 'risposta di az non leggibile' } }
  }
}

export async function currentSubscription($: EngineInterface): Promise<{ ok: true; sub: { id: string; name: string } } | Extract<AzRun, { ok: false }>> {
  const r = await runAz($, ['account', 'show', '--query', '{id:id,name:name}'])
  if (!r.ok) return r
  const j = r.json as { id?: unknown; name?: unknown }
  return typeof j.id === 'string' && typeof j.name === 'string'
    ? { ok: true, sub: { id: j.id.toLowerCase(), name: j.name } }
    : { ok: false, error: { at: await $.clock.now(), code: 'other', message: 'sottoscrizione non leggibile' } }
}
