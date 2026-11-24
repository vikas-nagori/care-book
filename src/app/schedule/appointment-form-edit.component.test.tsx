import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Appointment, AppointmentType } from '@/lib/supabase/types'

// Edit Appointment: its own checks before it writes the row (C-3, G-17c) and a write that
// matched no row (G-3).

const mocks = vi.hoisted(() => ({ toast: vi.fn(), update: vi.fn(), select: vi.fn() }))
vi.mock('./external-assignees', () => ({ getExternalAssigneeOptions: async () => ({ ok: true, profiles: [] }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: () => ({ update: mocks.update }) }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/lib/observability/report-booking-event', () => ({ reportBookingEvent: vi.fn() }))
vi.mock('@/components/referral/referral-fields', () => ({
  ReferralFields: () => null,
  useReferralSelection: () => ({ referralSource: '' }),
}))

import { AppointmentForm } from './appointment-form'

const patient = { id: '11111111-1111-4111-8111-111111111111', name: 'Patient One' }
const clinic: AppointmentType = {
  id: '33333333-3333-4333-8333-333333333333', clinic_id: 'clinic', name: 'Clinic Visit',
  session_rate: 800, is_shared: true, is_default: true, sort_order: 0, created_at: '',
}
const appointment: Appointment = {
  id: 'appointment-1', patient_id: patient.id, clinic_id: 'clinic', date: '2026-11-21', time: '09:00:00',
  duration_minutes: 50, type: 'Clinic Visit', appointment_type_id: clinic.id, type_is_shared: true,
  status: 'scheduled', payment_status: 'unpaid', fee: 800, notes: null, created_by: 'admin-1',
  assigned_to: null, external_staff_id: null, external_profile_id: null, created_at: '',
}

function mountEdit(row: Appointment, canViewPaymentSignals = true) {
  const onSuccess = vi.fn()
  render(canViewPaymentSignals
    ? <AppointmentForm patients={[patient]} canViewPaymentSignals initialAppointmentTypes={[clinic]} appointment={row} onSuccess={onSuccess} />
    : <AppointmentForm patients={[patient]} canViewPaymentSignals={false} initialAppointmentTypes={[clinic]} appointment={row} onSuccess={onSuccess} />)
  return onSuccess
}

function submit() {
  fireEvent.submit(screen.getByLabelText('Time *').closest('form')!)
}

function lastToast() {
  return mocks.toast.mock.calls.at(-1)?.[0] as { title: string; description?: string } | undefined
}

describe('Edit Appointment', () => {
  beforeEach(() => {
    mocks.toast.mockReset()
    mocks.update.mockReset()
    mocks.select.mockReset()
    mocks.select.mockResolvedValue({ data: [{ id: appointment.id }], error: null })
    mocks.update.mockReturnValue({ eq: () => ({ select: mocks.select }) })
  })
  afterEach(cleanup)

  describe('session fee (decision D4c)', () => {
    it('refuses a cleared fee and writes nothing', async () => {
      const onSuccess = mountEdit(appointment)
      fireEvent.change(screen.getByLabelText('Session Fee (₹)'), { target: { value: '' } })
      submit()
      await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Session fee required', variant: 'destructive' }))
      expect(lastToast()?.description).toMatch(/0 for a free session/)
      expect(mocks.update).not.toHaveBeenCalled()
      expect(onSuccess).not.toHaveBeenCalled()
    })

    it('saves a fee of 0', async () => {
      const onSuccess = mountEdit(appointment)
      fireEvent.change(screen.getByLabelText('Session Fee (₹)'), { target: { value: '0' } })
      submit()
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ fee: 0 }))
    })

    it('lets a legacy row with no fee be edited when the fee is left alone', async () => {
      const onSuccess = mountEdit({ ...appointment, fee: null })
      fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Moved by phone' } })
      submit()
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ fee: null, notes: 'Moved by phone' }))
    })

    it('asks a legacy row for a fee once the admin has touched the field', async () => {
      mountEdit({ ...appointment, fee: null })
      const fee = screen.getByLabelText('Session Fee (₹)')
      fireEvent.change(fee, { target: { value: '5' } })
      fireEvent.change(fee, { target: { value: '' } })
      submit()
      await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Session fee required' }))
      expect(mocks.update).not.toHaveBeenCalled()
    })

    it('never asks Staff, who do not see the fee, and never writes it', async () => {
      const onSuccess = mountEdit({ ...appointment, fee: null }, false)
      expect(screen.queryByLabelText('Session Fee (₹)')).toBeNull()
      submit()
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('fee')
    })
  })

  describe('a row deleted meanwhile (G-3)', () => {
    it('says the appointment no longer exists instead of "Appointment updated"', async () => {
      mocks.select.mockResolvedValue({ data: [], error: null })
      const onSuccess = mountEdit(appointment)
      fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Too late' } })
      submit()
      await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Appointment not updated', variant: 'destructive' }))
      expect(lastToast()?.description).toMatch(/no longer exists/)
      expect(mocks.select).toHaveBeenCalledWith('id')
      expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Appointment updated' }))
      expect(onSuccess).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Update' })).toHaveProperty('disabled', false)
    })
  })

  describe('duration (G-17c)', () => {
    it('refuses a duration of 0 instead of saving 45', async () => {
      const onSuccess = mountEdit(appointment)
      fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '0' } })
      submit()
      await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Appointment not updated', variant: 'destructive' }))
      expect(lastToast()?.description).toMatch(/Duration must be/)
      expect(mocks.update).not.toHaveBeenCalled()
      expect(onSuccess).not.toHaveBeenCalled()
    })

    it('still saves a blank duration as the default 45 minutes', async () => {
      const onSuccess = mountEdit(appointment)
      fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '' } })
      submit()
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ duration_minutes: 45 }))
    })
  })
})
