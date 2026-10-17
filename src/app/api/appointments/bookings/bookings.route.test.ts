import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), revalidatePath: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/logger', () => ({ logger: mocks.logger }))

import { POST } from './route'
import { POST as status } from './status/route'

const correlationId = '12345678-1234-4234-8234-123456789012'
const clinicId = '44444444-4444-4444-8444-444444444444'
const userId = '33333333-3333-4333-8333-333333333333'
const body = () => ({ correlationId, input: {
  patientId: '11111111-1111-4111-8111-111111111111', date: '2026-10-17', time: '15:00', durationMinutes: 45,
  appointmentTypeId: '22222222-2222-4222-8222-222222222222', fee: 500, notes: 'private clinical note',
} })
const request = (value: unknown = body(), headers: Record<string, string> = {}) => new Request('http://localhost/api/appointments/bookings', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value),
})

function database(role = 'staff', accountStatus = 'active', clinicStatus = 'active') {
  const rows: Record<string, unknown>[] = []
  const writes: Record<string, unknown>[] = []
  const scopes: { table: string; clinicId: unknown }[] = []
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })) },
    from(table: string) {
      let inserted: Record<string, unknown>[] | undefined
      const filters = new Map<string, unknown>()
      const query = {
        select() { return query },
        eq(key: string, value: unknown) { filters.set(key, value); return query },
        in(key: string, value: unknown) { filters.set(key, value); return query },
        insert(value: Record<string, unknown> | Record<string, unknown>[]) { inserted = Array.isArray(value) ? value : [value]; return query },
        maybeSingle() { return query },
        single() { return query },
        then(resolve: (value: unknown) => unknown) {
          if (table === 'profiles') return Promise.resolve({ data: { id: userId, role, status: accountStatus, clinic_id: clinicId, clinic: { status: clinicStatus } }, error: null }).then(resolve)
          if (!inserted) scopes.push({ table, clinicId: filters.get('clinic_id') })
          if (table === 'appointment_types') return Promise.resolve({ data: { is_shared: true, session_rate: 700 }, error: null }).then(resolve)
          if (inserted) {
            writes.push(...inserted)
            rows.push(...inserted)
            return Promise.resolve({ data: inserted.map(({ id }) => ({ id })), error: null }).then(resolve)
          }
          let selected = rows.filter(row => row.clinic_id === filters.get('clinic_id'))
          for (const [key, value] of filters) {
            selected = selected.filter(row => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)
          }
          return Promise.resolve({ data: selected, error: null }).then(resolve)
        },
      }
      return query
    },
  }
  return { client, rows, writes, scopes }
}

beforeEach(() => { vi.clearAllMocks() })

describe('authenticated independent booking endpoints', () => {
  it('creates bookings scoped to the active clinic and echoes its correlation ID', async () => {
    const db = database()
    mocks.createClient.mockResolvedValue(db.client)
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('x-correlation-id')).toBe(correlationId)
    const result = await response.json()
    expect(result.success).toBe(true)
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0]).toMatchObject({ clinic_id: clinicId, created_by: userId, fee: 700 })
    expect(db.scopes.every(scope => scope.clinicId === clinicId)).toBe(true)
    const confirmed = await status(request())
    expect(await confirmed.json()).toEqual(result)
    expect(db.writes).toHaveLength(1)
  })

  it('rejects anonymous, blocked, inactive-clinic and unsupported-role requests without writes', async () => {
    for (const [role, accountStatus, clinicStatus] of [['staff', 'blocked', 'active'], ['staff', 'active', 'inactive'], ['platform_admin', 'active', 'active']]) {
      const db = database(role, accountStatus, clinicStatus)
      mocks.createClient.mockResolvedValue(db.client)
      const response = await POST(request())
      expect(response.status).toBe(403)
      expect((await response.json()).errorCode).toBe('SCHEDULE_UNAUTHORIZED')
      expect(db.writes).toHaveLength(0)
    }
    const db = database()
    db.client.auth.getUser.mockResolvedValue({ data: { user: null } as never, error: null })
    mocks.createClient.mockResolvedValue(db.client)
    expect((await POST(request())).status).toBe(401)
    expect(db.writes).toHaveLength(0)
  })

  it('rejects bad JSON, invalid fields and foreign browser origins without writes', async () => {
    const db = database()
    mocks.createClient.mockResolvedValue(db.client)
    const malformed = new Request('http://localhost/api/appointments/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
    for (const value of [malformed, request({ ...body(), input: { ...body().input, durationMinutes: '45' } }), request(body(), { origin: 'http://other-site.test' }), request(body(), { 'content-type': 'text/plain' })]) {
      const response = await POST(value)
      expect([400, 403, 415]).toContain(response.status)
      expect((await response.json()).success).toBe(false)
    }
    expect(db.writes).toHaveLength(0)
  })

  it('returns a read-only missing status and never logs clinical data', async () => {
    const db = database()
    mocks.createClient.mockResolvedValue(db.client)
    const missing = await status(request())
    expect((await missing.json()).errorCode).toBe('BOOKING_NOT_FOUND')
    expect(db.writes).toHaveLength(0)
    await POST(request())
    const logged = JSON.stringify([mocks.logger.info.mock.calls, mocks.logger.warn.mock.calls, mocks.logger.error.mock.calls])
    expect(logged).toContain(correlationId)
    expect(logged).not.toContain('private clinical note')
    expect(logged).not.toContain(body().input.patientId)
    expect(logged).not.toContain(userId)
    expect(logged).not.toContain(clinicId)
  })

  it('reports success even when cache revalidation throws after the database commit', async () => {
    const db = database()
    mocks.createClient.mockResolvedValue(db.client)
    mocks.revalidatePath.mockImplementationOnce(() => { throw new Error('cache unavailable') })
    const response = await POST(request())
    expect((await response.json()).success).toBe(true)
    expect(db.rows).toHaveLength(1)
  })
})
