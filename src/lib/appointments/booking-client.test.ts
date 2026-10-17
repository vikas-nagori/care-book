import assert from 'node:assert/strict'
import test from 'node:test'
import { BookingTransportError, requestBooking, withBookingDeadline } from './booking-client.ts'
import type { BookingRequest } from './booking-contract.ts'

const request: BookingRequest = {
  correlationId: '00000000-0000-4000-8000-000000000001',
  input: {
    patientId: '00000000-0000-4000-8000-000000000002', date: '2026-11-01', time: '15:00',
    durationMinutes: 45, appointmentTypeId: '00000000-0000-4000-8000-000000000003', fee: 800, notes: null,
  },
}
test('deadline bounds a promise that ignores cancellation', async () => {
  await assert.rejects(withBookingDeadline(new Promise(() => {}), 5), (error: unknown) =>
    error instanceof BookingTransportError && error.code === 'BOOKING_TIMEOUT')
})
test('timeout aborts transport, including a response body that never finishes', async () => {
  const previous = globalThis.fetch
  let signal: AbortSignal | undefined
  globalThis.fetch = async (_url, init) => {
    signal = init?.signal as AbortSignal
    return { ok: true, json: () => new Promise(() => {}) } as unknown as Response
  }
  try {
    await assert.rejects(requestBooking(request, 'create', 5), { code: 'BOOKING_TIMEOUT' })
    assert.equal(signal?.aborted, true)
  } finally { globalThis.fetch = previous }
})
test('invalid or redirected responses are uncertain and never treated as saved', async () => {
  const previous = globalThis.fetch
  try {
    for (const response of [
      new Response('<html>Login</html>'),
      new Response(JSON.stringify({ success: true, appointmentIds: [] })),
      new Response(JSON.stringify({ success: false, message: 'No code' })),
      { redirected: true, ok: true, json: async () => ({ success: true, appointmentIds: ['00000000-0000-4000-8000-000000000004'] }) } as Response,
    ]) {
      globalThis.fetch = async () => response
      await assert.rejects(requestBooking(request), { code: 'BOOKING_INVALID_RESPONSE' })
    }
  } finally { globalThis.fetch = previous }
})
test('status checks are separate requests with the same immutable attempt', async () => {
  const previous = globalThis.fetch
  let calledUrl: unknown
  let calledInit: RequestInit | undefined
  globalThis.fetch = async (url, init) => {
    calledUrl = url; calledInit = init
    return new Response(JSON.stringify({ success: false, errorCode: 'BOOKING_NOT_FOUND', message: 'No saved booking found.' }))
  }
  try {
    assert.equal((await requestBooking(request, 'status')).success, false)
    assert.equal(calledUrl, '/api/appointments/bookings/status')
    assert.equal(calledInit?.credentials, 'same-origin')
    assert.deepEqual(JSON.parse(String(calledInit?.body)), request)
  } finally { globalThis.fetch = previous }
})
