import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const auth = vi.hoisted(() => ({ profile: null as null | { id: string; clinic_id: string; role: 'admin' | 'staff'; status: string; clinic: { status: string } } }))
vi.mock('@/lib/auth', () => ({ getCurrentProfile: async () => auth.profile }))
import { POST } from './route'
const correlationId = '00000000-0000-4000-8000-000000000001'
function request(body: unknown, origin = 'http://localhost') {
  return new Request('http://localhost/api/telemetry', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
beforeEach(() => {
  auth.profile = { id: crypto.randomUUID(), clinic_id: 'clinic', role: 'staff', status: 'active', clinic: { status: 'active' } }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => vi.unstubAllEnvs())
it('rejects anonymous, cross-origin, blocked and inactive-clinic reports', async () => {
  const valid = { operation: 'PatientForm/save', correlationId }
  expect((await POST(request(valid, 'http://evil.test'))).status).toBe(403)
  auth.profile!.status = 'blocked'
  expect((await POST(request(valid))).status).toBe(403)
  auth.profile!.status = 'active'; auth.profile!.clinic.status = 'inactive'
  expect((await POST(request(valid))).status).toBe(403)
  auth.profile = null
  expect((await POST(request(valid))).status).toBe(401)
  expect(console.error).not.toHaveBeenCalled()
})
it('allows only bounded reports with a fixed, non-clinical payload', async () => {
  const body = { operation: 'PatientForm/save', correlationId, patientName: 'Private Name', message: 'Private detail', path: '/patients/private-id' }
  for (let i = 0; i < 5; i++) expect((await POST(request(body))).status).toBe(204)
  expect((await POST(request(body))).status).toBe(429)
  const output = JSON.stringify(vi.mocked(console.error).mock.calls)
  expect(output).toContain('client/PatientForm/save')
  expect(output).toContain('CLIENT_OPERATION_FAILED')
  expect(output).not.toContain('Private')
  expect(output).not.toContain('/patients/private-id')
})
it('rejects unknown operations and oversized inputs before logging', async () => {
  expect((await POST(request({ operation: 'private text', correlationId }))).status).toBe(400)
  expect((await POST(request({ operation: 'PatientForm/save', correlationId, message: 'x'.repeat(1000) }))).status).toBe(413)
  expect(console.error).not.toHaveBeenCalled()
})

it('logs safe booking stages at meaningful levels with the same correlation and release', async () => {
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abcdef1234567890')
  const base = { operation: 'AppointmentForm/booking', correlationId, durationMs: 17, patientName: 'Private Patient', input: { notes: 'Private note' } }
  for (const phase of ['submit', 'request', 'confirmed', 'status_check', 'retry', 'timeout', 'unconfirmed', 'rejected', 'preparation_failed', 'options_failed']) {
    expect((await POST(request({ ...base, phase, errorCode: 'BOOKING_TIMEOUT' }))).status).toBe(204)
  }
  const info = vi.mocked(console.log).mock.calls.map(args => JSON.parse(String(args[0])))
  const warn = vi.mocked(console.warn).mock.calls.map(args => JSON.parse(String(args[0])))
  const error = vi.mocked(console.error).mock.calls.map(args => JSON.parse(String(args[0])))
  expect(info.map(event => event.meta.phase)).toEqual(['submit', 'request', 'confirmed', 'status_check', 'retry'])
  expect(warn.map(event => event.meta.phase)).toEqual(['timeout', 'unconfirmed'])
  expect(error.map(event => event.meta.phase)).toEqual(['rejected', 'preparation_failed', 'options_failed'])
  for (const event of [...info, ...warn, ...error]) {
    expect(event.context).toBe('client/AppointmentForm/booking')
    expect(event.meta).toMatchObject({ correlationId, durationMs: 17, release: 'abcdef123456', source: 'client', errorCode: 'BOOKING_TIMEOUT' })
    expect(event.meta.userId).toBeUndefined()
  }
  expect(JSON.stringify([...info, ...warn, ...error])).not.toContain('Private')
})

it('separates the booking stage budget from legacy failures and rejects malformed booking fields', async () => {
  const legacy = { operation: 'PatientForm/save', correlationId }
  const booking = { operation: 'AppointmentForm/booking', correlationId, phase: 'request' }
  for (let i = 0; i < 5; i++) expect((await POST(request(legacy))).status).toBe(204)
  for (let i = 0; i < 60; i++) expect((await POST(request(booking))).status).toBe(204)
  expect((await POST(request(booking))).status).toBe(429)
  expect((await POST(request(legacy))).status).toBe(429)
  auth.profile!.id = crypto.randomUUID()
  expect((await POST(request({ ...booking, durationMs: -1 }))).status).toBe(400)
  expect((await POST(request({ ...booking, phase: 'private detail' }))).status).toBe(400)
})
