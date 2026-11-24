import { isAuthRetryableFetchError } from '@supabase/supabase-js'

/** The booking endpoints the schedule form calls with `fetch(…, { redirect: 'error' })`. */
export const BOOKING_API_PATHS: readonly string[] = ['/api/appointments/bookings', '/api/appointments/bookings/status']

/** What the booking route itself answers a signed-out request (booking-handler.ts). */
export const SIGNED_OUT_BOOKING_REPLY = {
  success: false,
  errorCode: 'SCHEDULE_UNAUTHORIZED',
  message: 'Sign in again to manage appointments.',
} as const

/**
 * The middleware's answer to a booking API request that has no signed-in user, or null to fall
 * back to the usual redirect to /login (G-18).
 *
 * The booking client refuses redirects and treats one as a dropped connection, so a 307 to /login
 * made it resend three times and end on "Booking not confirmed". A JSON 401 is a final answer it
 * shows as "Sign in again to manage appointments.", like the payment-due PDF API's carve-out.
 *
 * Only a missing or rejected session gets the 401. When Supabase Auth could not be reached at all
 * the session may be fine, so that keeps the old behaviour, which the client retries.
 */
export function signedOutBookingApiReply(
  path: string,
  authError: unknown,
): { status: 401; body: typeof SIGNED_OUT_BOOKING_REPLY } | null {
  if (!BOOKING_API_PATHS.includes(path)) return null
  if (isAuthRetryableFetchError(authError)) return null
  return { status: 401, body: SIGNED_OUT_BOOKING_REPLY }
}
