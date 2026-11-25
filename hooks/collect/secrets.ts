/*
 * secrets.ts — the last filter before a value read from Azure is kept: anything that
 * looks like a key, a signature, a token (JWT, GitHub), a long base64 run or a password
 * is dropped, and kept strings are cut at 256 characters. A long run counts as a secret when
 * it mixes capitals, small letters and digits (keys and tokens do; paths and names do not);
 * a run of exactly 40 or 64 hex digits is a commit hash or a digest (an image tag): kept,
 * any other long hex run is not.
 */
const PATTERNS = [/AccountKey=/i, /SharedAccessSignature/i, /[?&]sig=/i, /eyJ[A-Za-z0-9_-]{10,}/, /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /password/i]
const LONG_RUNS = [/[A-Za-z0-9+/]{40,}={0,2}/g, /[A-Za-z0-9_-]{40,}/g]
const HEX = /^[0-9a-f]+$/i

const isHash = (run: string): boolean => HEX.test(run) && (run.length === 40 || run.length === 64)
const isMixed = (run: string): boolean => /[A-Z]/.test(run) && /[a-z]/.test(run) && /[0-9]/.test(run)
const isSecretRun = (run: string): boolean => !isHash(run) && (HEX.test(run) || isMixed(run))

export const isSecretLike = (v: string): boolean =>
  PATTERNS.some(p => p.test(v)) || LONG_RUNS.some(re => (v.match(re) ?? []).some(isSecretRun))

/** A fact value as kept: strings filtered and capped, numbers and booleans as they are, anything else dropped. */
export const cleanValue = (v: unknown): string | number | boolean | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'boolean') return v
  if (typeof v !== 'string' || v === '' || isSecretLike(v)) return undefined
  return v.slice(0, 256)
}
