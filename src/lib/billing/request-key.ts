// Request ids that make a billing save idempotent (G-14).
//
// The entry form sends one id per attempt. A resend of the same input (a double tap, or a retry
// after the reply was lost on a weak signal) reuses it, so record_payment_v2 /
// record_billing_entry_v2 return the first result instead of recording the receipt twice. Any
// change to the input starts a new attempt with a new id.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isRequestKey(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/** A random v4 UUID. `crypto.randomUUID` needs a secure context, so fall back to getRandomValues. */
export function newRequestKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export type RequestAttempt = { fingerprint: string; key: string }

/** Keep the attempt (and its id) while the input is unchanged; otherwise start a new one. */
export function attemptFor(previous: RequestAttempt | null, fingerprint: string, makeKey: () => string = newRequestKey): RequestAttempt {
  if (previous && previous.fingerprint === fingerprint) return previous
  return { fingerprint, key: makeKey() }
}
