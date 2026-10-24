import assert from 'node:assert/strict'
import test from 'node:test'
import { BookingTransportError, createBookingWithRetry, requestBooking, withBookingDeadline } from './booking-client.ts'
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

const saved = () => new Response(JSON.stringify({ success: true, appointmentIds: ['00000000-0000-4000-8000-000000000004'] }))
const quick = { attemptTimeoutMs: 20, totalTimeoutMs: 1_000, pauseMs: 1 }
async function withFetch<T>(implementation: typeof fetch, run: (bodies: unknown[]) => Promise<T>) {
  const previous = globalThis.fetch
  const bodies: unknown[] = []
  globalThis.fetch = async (url, init) => { bodies.push(JSON.parse(String(init?.body))); return implementation(url, init) }
  try { return await run(bodies) } finally { globalThis.fetch = previous }
}
const stall: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
})

test('a stalled first attempt is abandoned early and the identical booking is resent', async () => {
  let calls = 0
  const retried: string[] = []
  await withFetch(async (url, init) => (++calls === 1 ? stall(url, init) : saved()), async bodies => {
    const result = await createBookingWithRetry(request, { ...quick, onRetry: code => retried.push(code) })
    assert.equal(result.success, true)
    assert.equal(bodies.length, 2)
    assert.deepEqual(bodies[1], bodies[0])
    assert.deepEqual(bodies[0], request)
    assert.deepEqual(retried, ['BOOKING_TIMEOUT'])
  })
})
test('a dropped connection is resent at once with the same booking', async () => {
  let calls = 0
  await withFetch(async () => { if (++calls === 1) throw new TypeError('Load failed'); return saved() }, async bodies => {
    assert.equal((await createBookingWithRetry(request, quick)).success, true)
    assert.equal(bodies.length, 2)
    assert.deepEqual(bodies[1], bodies[0])
  })
})
test('a server answer is final and never resent, even when it is a failure', async () => {
  await withFetch(async () => new Response(JSON.stringify({ success: false, errorCode: 'APPOINTMENT_CONFLICT', message: 'Taken.' }), { status: 409 }), async bodies => {
    assert.equal((await createBookingWithRetry(request, quick)).success, false)
    assert.equal(bodies.length, 1)
  })
})
test('an unreadable response is not resent', async () => {
  await withFetch(async () => new Response('<html>Login</html>'), async bodies => {
    await assert.rejects(createBookingWithRetry(request, quick), { code: 'BOOKING_INVALID_RESPONSE' })
    assert.equal(bodies.length, 1)
  })
})
test('a persistent outage gives up after the attempt limit with the last transport error', async () => {
  await withFetch(async () => { throw new TypeError('Load failed') }, async bodies => {
    await assert.rejects(createBookingWithRetry(request, { ...quick, maxAttempts: 4 }), { code: 'BOOKING_REQUEST_FAILED' })
    assert.equal(bodies.length, 4)
  })
})
test('the whole operation stays inside the overall deadline, giving the last attempt the remaining time', async () => {
  const started = Date.now()
  await withFetch(stall, async bodies => {
    await assert.rejects(createBookingWithRetry(request, { attemptTimeoutMs: 20, totalTimeoutMs: 120, pauseMs: 1, maxAttempts: 10 }), { code: 'BOOKING_TIMEOUT' })
    assert.ok(Date.now() - started < 400)
    assert.ok(bodies.length >= 2 && bodies.length <= 6)
  })
})
test('stops resending once the caller no longer wants the result', async () => {
  await withFetch(async () => { throw new TypeError('Load failed') }, async bodies => {
    await assert.rejects(createBookingWithRetry(request, { ...quick, shouldRetry: () => false }), { code: 'BOOKING_REQUEST_FAILED' })
    assert.equal(bodies.length, 1)
  })
})
