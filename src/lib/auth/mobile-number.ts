// Indian mobile numbers are the sign-in identifier, and they are exactly 10 digits everywhere:
// what people type, what `profiles.mobile_number` / `user_invites.mobile_number` store, and what
// Supabase Auth stores in `auth.users.phone` and matches on at sign-in. No country code is added.
//
// Supabase Auth does not require a country code: it strips a leading `+` and spaces, then accepts
// 2–15 digits and matches sign-in on that exact string. So `9511219264` and `919511219264` would
// be two different logins — which is why every number crossing a boundary goes through
// `normalizeMobileNumber` and nothing else ever reaches Auth.
//
// Caveat for the future: Auth reads a bare number as E.164, so `9511219264` would be "+95…"
// (Myanmar) if Auth ever sent it an SMS. Password sign-in never sends SMS; adding SMS codes would
// need `91` prefixed at that point.

const MOBILE_NUMBER_PATTERN = /^[6-9][0-9]{9}$/

/**
 * The 10-digit mobile number, or null. Spaces and dashes between digits are ignored; a country
 * code (`+91`, `91…`) or a leading `0` is not accepted — the number must be the 10 digits alone.
 */
export function normalizeMobileNumber(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.trim().replace(/[\s-]/g, '')
  return MOBILE_NUMBER_PATTERN.test(digits) ? digits : null
}

/** The `auth.users.phone` value for a mobile number: the same 10 digits. */
export function toAuthPhone(mobileNumber: string): string {
  return mobileNumber
}

/** The mobile number held in an `auth.users.phone` value, or null if it is not a 10-digit one. */
export function fromAuthPhone(authPhone: string | null | undefined): string | null {
  return normalizeMobileNumber(authPhone)
}

/** `95112 19264` for screens and share messages; unrecognised input is returned trimmed. */
export function formatMobileNumber(raw: string | null | undefined): string {
  const mobileNumber = normalizeMobileNumber(raw)
  if (!mobileNumber) return raw?.trim() ?? ''
  return `${mobileNumber.slice(0, 5)} ${mobileNumber.slice(5)}`
}

export const MOBILE_NUMBER_INVALID_MESSAGE = 'Enter your 10-digit mobile number, without +91 or 0.'

/** How to name an account on screen: its email if it has one, else its mobile number. */
export function accountContactLabel(account: { email?: string | null; mobile_number?: string | null }): string {
  return account.email?.trim() || formatMobileNumber(account.mobile_number) || 'No contact details'
}
