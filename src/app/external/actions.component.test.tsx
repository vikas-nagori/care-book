import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getCurrentProfile, rpc } = vi.hoisted(() => ({ getCurrentProfile: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentProfile }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }))

import { createExternalAppointment } from './actions'

const request = {
  id: '00000000-0000-4000-8000-000000000001',
  patient_id: '00000000-0000-4000-8000-000000000002',
  appointment_type_id: '00000000-0000-4000-8000-000000000003',
  date: '2026-11-21',
  time: '09:15',
  duration_minutes: 45,
}
const appointment = {
  id: '00000000-0000-4000-8000-000000000004',
  patient_id: request.patient_id,
  patient_name: 'Asha Patel',
  date: request.date,
  time: request.time,
  duration_minutes: request.duration_minutes,
  type: 'Clinic visit',
  status: 'scheduled',
}

describe('external booking action', () => {
  beforeEach(() => {
    // 21 Nov 2026, 11:30 IST: the request date is the clinic's today.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-21T06:00:00Z'))
    getCurrentProfile.mockResolvedValue({ status: 'active', role: 'external_staff', clinic_id: 'clinic' })
  })
  afterEach(() => vi.useRealTimers())

  it('calls the narrow RPC with only accepted booking intent and returns a safe projection', async () => {
    rpc.mockResolvedValue({ data: { ...appointment, notes: 'private', fee: 1000 }, error: null })
    await expect(createExternalAppointment(request)).resolves.toEqual({ success: true, appointment })
    expect(rpc).toHaveBeenCalledWith('external_create_appointment', { p_request: request })
  })

  it('rejects ineligible callers before the booking RPC', async () => {
    getCurrentProfile.mockResolvedValue({ status: 'active', role: 'staff', clinic_id: 'clinic' })
    await expect(createExternalAppointment(request)).resolves.toMatchObject({ success: false, accessDenied: true })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a date before the clinic today without calling the booking RPC', async () => {
    // 00:30 IST on 22 Nov is still 21 Nov in UTC; the clinic date decides.
    vi.setSystemTime(new Date('2026-11-21T19:00:00Z'))
    await expect(createExternalAppointment(request)).resolves.toEqual({
      success: false,
      message: 'Choose today or a later date.',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('signals revoked access without returning the backend error or sensitive fields', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'sensitive upstream details' } })
    await expect(createExternalAppointment(request)).resolves.toEqual({
      success: false,
      accessDenied: true,
      message: 'Your access may have changed. If you need access, contact your clinic admin.',
    })
  })
})
