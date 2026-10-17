import assert from 'node:assert/strict'
import test from 'node:test'

const correlationId = '00000000-0000-4000-8000-000000000001'

async function reporter() {
  const reporterModule = await import('./report-booking-event.ts').catch(() => ({}))
  const report = (reporterModule as Record<string, unknown>).reportBookingEvent
  assert.equal(typeof report, 'function', 'booking reporter is available')
  return report as (input: Record<string, unknown>) => void
}

test('booking reporting starts independent fetch without awaiting it and preserves correlation', async (t) => {
  const report = await reporter()
  const requests: { url: unknown; init: RequestInit | undefined }[] = []
  t.mock.method(globalThis, 'fetch', (url: unknown, init?: RequestInit) => {
    requests.push({ url, init })
    return new Promise<Response>(() => {})
  })
  const result = report({ correlationId, phase: 'request', durationMs: 3, patientName: 'Private Patient' })
  assert.equal(result, undefined)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/telemetry')
  assert.equal(requests[0].init?.method, 'POST')
  assert.equal(requests[0].init?.credentials, 'same-origin')
  assert.equal(requests[0].init?.keepalive, true)
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
    operation: 'AppointmentForm/booking', correlationId, phase: 'request', durationMs: 3,
  })
})

test('telemetry failures cannot throw into a booking or recurse into reporting', async (t) => {
  const report = await reporter()
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new TypeError('offline') })
  assert.doesNotThrow(() => report({ correlationId, phase: 'submit' }))
  fetch.mock.mockImplementation(() => Promise.reject(new TypeError('offline')))
  assert.doesNotThrow(() => report({ correlationId, phase: 'request' }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fetch.mock.callCount(), 2)
})

test('invalid booking events are dropped and successive stages are retained', async (t) => {
  const report = await reporter()
  const requests: Record<string, unknown>[] = []
  t.mock.method(globalThis, 'fetch', (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)))
    return Promise.resolve(new Response(null, { status: 204 }))
  })
  report({ correlationId: 'private patient', phase: 'submit' })
  report({ correlationId, phase: 'private text' })
  assert.equal(requests.length, 0)
  report({ correlationId, phase: 'submit' })
  report({ correlationId, phase: 'request' })
  report({ correlationId, phase: 'confirmed' })
  assert.deepEqual(requests.map(event => event.phase), ['submit', 'request', 'confirmed'])
  assert.ok(requests.every(event => event.correlationId === correlationId))
})
