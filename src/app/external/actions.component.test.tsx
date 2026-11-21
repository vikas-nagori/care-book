import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getCurrentProfile, rpc } = vi.hoisted(() => ({ getCurrentProfile: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentProfile }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }))

import { createExternalAppointment, updateExternalAppointment } from './actions'

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
  appointment_type_id: request.appointment_type_id,
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

const update = {
  id: appointment.id,
  appointment_type_id: request.appointment_type_id,
  date: '2026-11-22',
  time: '10:30',
  duration_minutes: 60,
  status: 'scheduled',
}

describe('external appointment update action', () => {
  beforeEach(() => {
    // 21 Nov 2026, 11:30 IST.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-21T06:00:00Z'))
    getCurrentProfile.mockResolvedValue({ status: 'active', role: 'external_staff', clinic_id: 'clinic' })
  })
  afterEach(() => vi.useRealTimers())

  it('calls the narrow update RPC with only the accepted intent and returns a safe projection', async () => {
    const moved = { ...appointment, date: update.date, time: '10:30:00', duration_minutes: 60 }
    rpc.mockResolvedValue({ data: { ...moved, fee: 1000, notes: 'private', payment_status: 'unpaid' }, error: null })
    await expect(updateExternalAppointment(update)).resolves.toEqual({ success: true, appointment: moved })
    expect(rpc).toHaveBeenCalledWith('external_update_appointment', { p_request: update })
  })

  it('rejects ineligible callers and malformed or extended payloads before the RPC', async () => {
    getCurrentProfile.mockResolvedValue({ status: 'active', role: 'admin', clinic_id: 'clinic' })
    await expect(updateExternalAppointment(update)).resolves.toMatchObject({ success: false, accessDenied: true })
    getCurrentProfile.mockResolvedValue({ status: 'active', role: 'external_staff', clinic_id: 'clinic' })
    for (const invalid of [{ ...update, fee: 0 }, { ...update, status: 'completed' }, { ...update, patient_id: request.patient_id }]) {
      await expect(updateExternalAppointment(invalid)).resolves.toEqual({
        success: false,
        message: 'Check the appointment details and try again.',
      })
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses to reschedule before the clinic today, but still lets a past-dated slot be cancelled', async () => {
    await expect(updateExternalAppointment({ ...update, date: '2026-11-20' })).resolves.toEqual({
      success: false,
      message: 'Choose today or a later date.',
    })
    expect(rpc).not.toHaveBeenCalled()
    const cancelled = { ...appointment, date: '2026-11-20', status: 'cancelled' }
    rpc.mockResolvedValue({ data: cancelled, error: null })
    const cancel = { ...update, date: '2026-11-20', status: 'cancelled' }
    await expect(updateExternalAppointment(cancel)).resolves.toEqual({ success: true, appointment: cancelled })
    expect(rpc).toHaveBeenCalledWith('external_update_appointment', { p_request: cancel })
  })

  it.each([
    ['42501', { accessDenied: true, message: 'Your access may have changed. If you need access, contact your clinic admin.' }],
    ['23P01', { message: 'You already have an appointment for this patient at that time.' }],
    ['P0002', { message: 'This appointment can no longer be changed.' }],
    ['22023', { message: 'These appointment details could not be saved. Check your selections and try again.' }],
    ['P0001', { message: 'Unable to update this appointment right now. Try again.' }],
  ])('maps database error %s to a message without the backend detail', async (code, expected) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'sensitive upstream details' } })
    await expect(updateExternalAppointment(update)).resolves.toEqual({ success: false, ...expected })
  })

  it('treats a response that fails the safe projection as a failure', async () => {
    rpc.mockResolvedValue({ data: { ...appointment, appointment_type_id: undefined }, error: null })
    await expect(updateExternalAppointment(update)).resolves.toEqual({
      success: false,
      message: 'Unable to update this appointment right now. Try again.',
    })
  })
})
