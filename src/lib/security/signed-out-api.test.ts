import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js'

import { BOOKING_API_PATHS, SIGNED_OUT_BOOKING_REPLY, signedOutBookingApiReply } from './signed-out-api.ts'

test('a signed-out booking or status request gets the route\'s own 401 JSON instead of a redirect (G-18)', () => {
  for (const path of BOOKING_API_PATHS) {
    for (const error of [new AuthSessionMissingError(), new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found'), null]) {
      assert.deepEqual(signedOutBookingApiReply(path, error), { status: 401, body: SIGNED_OUT_BOOKING_REPLY }, path)
    }
  }
  assert.deepEqual(SIGNED_OUT_BOOKING_REPLY, {
    success: false,
    errorCode: 'SCHEDULE_UNAUTHORIZED',
    message: 'Sign in again to manage appointments.',
  })
})

test('Supabase Auth being unreachable keeps the redirect, which the booking client retries', () => {
  for (const path of BOOKING_API_PATHS) {
    assert.equal(signedOutBookingApiReply(path, new AuthRetryableFetchError('fetch failed', 0)), null)
  }
})

test('every other path keeps the redirect to /login', () => {
  for (const path of [
    '/', '/schedule', '/schedule/new', '/api/appointments', '/api/appointments/bookings/other',
    '/api/appointments/bookingsx', '/api/billing/payment-due/x/pdf', '/api/telemetry', '/api/version',
  ]) {
    assert.equal(signedOutBookingApiReply(path, new AuthSessionMissingError()), null, path)
  }
})
