import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  getPaymentDueStatementSource: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getCurrentProfile: mocks.getCurrentProfile }))
vi.mock('@/lib/billing/payment-due-statement.server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billing/payment-due-statement.server')>('@/lib/billing/payment-due-statement.server')
  return { ...actual, getPaymentDueStatementSource: mocks.getPaymentDueStatementSource }
})

import { POST } from './route'

const patientId = '00000000-0000-4000-b000-000000000001'

beforeEach(() => {
  mocks.getCurrentProfile.mockReset()
  mocks.getPaymentDueStatementSource.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('payment due PDF route', () => {
  it.each([
    { regularScope: 'all_due', periodMonth: undefined, filenameSuffix: '-all-regular.pdf' },
    { regularScope: 'previous_month', periodMonth: '2026-10', filenameSuffix: '-regular-2026-10.pdf' },
  ])('downloads a real PDF for $regularScope', async ({ regularScope, periodMonth, filenameSuffix }) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'))
    mocks.getCurrentProfile.mockResolvedValueOnce({ role: 'admin' })
    mocks.getPaymentDueStatementSource.mockResolvedValueOnce({
      snapshotAt: '2026-11-01T12:00:00Z',
      clinic: { name: 'Sample Clinic' },
      patient: { id: patientId, name: 'Sample Patient' },
      appointments: [{
        id: 'session-1', date: '2026-10-15', time: '09:00:00', type: 'Clinic',
        status: 'completed', chargeId: 'charge-1', chargeAmount: '800.00', chargeStatus: 'posted',
        packageId: null, packageLifecycle: null,
        applications: [{ amount: '300.00', status: 'active' }],
      }],
      packages: [],
    })

    const response = await POST(
      new Request(`http://localhost/api/billing/payment-due/${patientId}/pdf`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ regularScope, periodMonth }),
      }),
      { params: Promise.resolve({ patientId }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="payment-summary-Sample-Patient-2026-11-01${filenameSuffix}"`,
    )
    const buffer = Buffer.from(await response.arrayBuffer())
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buffer.length).toBeGreaterThan(500)
  })

  it('rejects a malformed request before reading billing data', async () => {
    const response = await POST(
      new Request('http://localhost/api/billing/payment-due/not-a-uuid/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ regularScope: 'unsupported' }),
      }),
      { params: Promise.resolve({ patientId: 'not-a-uuid' }) },
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toEqual({ errorCode: 'INVALID_REQUEST', message: 'Invalid payment PDF request.' })
  })

  it('returns JSON authorization errors for API callers', async () => {
    mocks.getCurrentProfile.mockResolvedValueOnce(null)
    const response = await POST(
      new Request('http://localhost/api/billing/payment-due/valid/pdf', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ regularScope: 'all_due' }),
      }),
      { params: Promise.resolve({ patientId }) },
    )
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ errorCode: 'UNAUTHORIZED', message: 'You need to sign in again.' })

    mocks.getCurrentProfile.mockResolvedValueOnce({ role: 'staff' })
    const forbidden = await POST(
      new Request('http://localhost/api/billing/payment-due/valid/pdf', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ regularScope: 'all_due' }),
      }),
      { params: Promise.resolve({ patientId }) },
    )
    expect(forbidden.status).toBe(403)
  })

  it('returns not found when the admin cannot access the patient', async () => {
    mocks.getCurrentProfile.mockResolvedValueOnce({ role: 'admin' })
    mocks.getPaymentDueStatementSource.mockResolvedValueOnce(null)
    const response = await POST(
      new Request('http://localhost/api/billing/payment-due/valid/pdf', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ regularScope: 'all_due' }),
      }),
      { params: Promise.resolve({ patientId }) },
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ errorCode: 'NOT_FOUND', message: 'Patient not found.' })
  })

  it('does not render or download an empty statement', async () => {
    mocks.getCurrentProfile.mockResolvedValueOnce({ role: 'admin' })
    mocks.getPaymentDueStatementSource.mockResolvedValueOnce({
      snapshotAt: '2026-09-06T04:30:00.000Z',
      clinic: { name: 'Sample Clinic' },
      patient: { id: patientId, name: 'Sample Patient' },
      appointments: [],
      packages: [],
    })
    const response = await POST(
      new Request('http://localhost/api/billing/payment-due/valid/pdf', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ regularScope: 'all_due' }),
      }),
      { params: Promise.resolve({ patientId }) },
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      errorCode: 'NO_PENDING_PAYMENT',
      message: 'No payment pending for the selected regular-session period or completed package sessions.',
    })
  })
})
