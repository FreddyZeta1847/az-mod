/*
 * secrets.ts — the last filter before a value read from Azure is kept: anything that
 * looks like a key, a signature, a token, a long base64 run or a password is dropped,
 * and kept strings are cut at 256 characters.
 */
const PATTERNS = [/AccountKey=/i, /SharedAccessSignature/i, /[?&]sig=/i, /eyJ[A-Za-z0-9_-]{10,}/, /[A-Za-z0-9+/]{40,}={0,2}/, /password/i]

export const isSecretLike = (v: string): boolean => PATTERNS.some(p => p.test(v))

/** A fact value as kept: strings filtered and capped, numbers and booleans as they are, anything else dropped. */
export const cleanValue = (v: unknown): string | number | boolean | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'boolean') return v
  if (typeof v !== 'string' || v === '' || isSecretLike(v)) return undefined
  return v.slice(0, 256)
}
