import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Appointment, AppointmentType } from '@/lib/supabase/types'

const mocks = vi.hoisted(() => ({ load: vi.fn(), toast: vi.fn(), update: vi.fn(), eq: vi.fn() }))
vi.mock('./external-assignees', () => ({ getExternalAssigneeOptions: mocks.load }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: () => ({ update: mocks.update }) }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/lib/observability/report-booking-event', () => ({ reportBookingEvent: vi.fn() }))
vi.mock('@/components/referral/referral-fields', () => ({
  ReferralFields: () => null,
  useReferralSelection: () => ({ referralSource: '' }),
}))

import { AppointmentForm } from './appointment-form'

const patientA = { id: '11111111-1111-4111-8111-111111111111', name: 'Patient One' }
const patientB = { id: '22222222-2222-4222-8222-222222222222', name: 'Patient Two' }
const externalProfile = { id: '55555555-5555-4555-8555-555555555555', full_name: 'Alex External', email: 'alex@example.test' }
const clinic: AppointmentType = {
  id: '33333333-3333-4333-8333-333333333333', clinic_id: 'clinic', name: 'Clinic Visit',
  session_rate: 800, is_shared: true, is_default: true, sort_order: 0, created_at: '',
}
const home: AppointmentType = {
  ...clinic,
  id: '44444444-4444-4444-8444-444444444444', name: 'Home Visit', is_shared: false, is_default: false, sort_order: 1,
}

function openSelect(name: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name }), { key: 'Enter' })
}

function choose(name: string, option: string | RegExp) {
  openSelect(name)
  fireEvent.click(screen.getByRole('option', { name: option }))
}

function mountAdmin() {
  render(<AppointmentForm
    patients={[patientA, patientB]}
    canManageExternalStaff
    canViewPaymentSignals
    initialAppointmentTypes={[clinic, home]}
    defaultPatientId={patientA.id}
    defaultDate="2026-11-21"
    assigneeOptions={[{ id: 'admin-1', full_name: 'Clinic Admin', email: 'admin@example.test', role: 'admin' }]}
    currentProfileId="admin-1"
  />)
}

const externalAppointment: Appointment = {
  id: 'appointment-1', patient_id: patientA.id, clinic_id: 'clinic', date: '2026-11-21', time: '09:00:00',
  duration_minutes: 45, type: 'Clinic Visit', appointment_type_id: clinic.id, type_is_shared: true,
  status: 'scheduled', payment_status: 'unpaid', fee: 800, notes: null, created_by: 'admin-1',
  assigned_to: null, external_staff_id: null, external_profile_id: externalProfile.id, created_at: '',
}

describe('external assignee selection', () => {
  beforeEach(() => {
    mocks.update.mockReturnValue({ eq: mocks.eq })
    mocks.eq.mockResolvedValue({ error: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, appointmentIds: ['appointment-1'] }))))
    mocks.load.mockImplementation(async (patientId: string) => ({
      ok: true,
      profiles: patientId === patientA.id ? [externalProfile] : [],
    }))
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('keeps a granted external assignee when switching from a restricted to a shared type', async () => {
    mountAdmin()
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(patientA.id))
    choose('Type', 'Home Visit')
    choose('Assigned Staff', /Alex External/)
    choose('Type', 'Clinic Visit')
    expect(screen.getByRole('combobox', { name: 'Assigned Staff' }).textContent).toContain('Alex External')
    fireEvent.submit(screen.getByLabelText('Time *').closest('form')!)

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
    expect(request.input).toMatchObject({
      appointmentTypeId: clinic.id,
      externalProfileId: externalProfile.id,
      assignedTo: null,
      externalStaffId: null,
    })
  })

  it('clears the pick when a different patient is selected and does not offer an ungranted account', async () => {
    mountAdmin()
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(patientA.id))
    choose('Assigned Staff', /Alex External/)
    fireEvent.change(screen.getByLabelText('Patient *'), { target: { value: 'Two' } })
    fireEvent.click(screen.getByRole('button', { name: 'Patient Two' }))
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(patientB.id))
    // Clinic Visit is shared: with nobody external to offer, there is no assignee to choose.
    expect(screen.queryByRole('combobox', { name: 'Assigned Staff' })).toBeNull()
    choose('Type', 'Home Visit')
    openSelect('Assigned Staff')
    expect(screen.queryByRole('option', { name: /Alex External/ })).toBeNull()
    expect(screen.getByRole('option', { name: 'Unassigned' })).toBeTruthy()
  })

  it('hides the assignee picker on a shared type while the patient has no External Staff', async () => {
    mocks.load.mockResolvedValue({ ok: true, profiles: [] })
    mountAdmin()
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(patientA.id))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Type' }).textContent).toContain('Clinic Visit'))
    expect(screen.queryByRole('combobox', { name: 'Assigned Staff' })).toBeNull()
    expect(screen.queryByText(/Share this patient from their profile/)).toBeNull()
  })

  it('tags each assignee so Staff and External Staff are told apart', async () => {
    mountAdmin()
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(patientA.id))
    choose('Type', 'Home Visit')
    openSelect('Assigned Staff')
    expect(screen.getByRole('option', { name: /^Clinic Admin\s*\(Admin\)$/ })).toBeTruthy()
    expect(screen.getByRole('option', { name: /^Alex External\s*\(External Staff\)$/ })).toBeTruthy()
  })

  it('preserves a historical external assignee on a note edit after access was revoked', async () => {
    mocks.load.mockResolvedValueOnce({ ok: true, profiles: [] })
    render(<AppointmentForm
      patients={[patientA]}
      canManageExternalStaff
      canViewPaymentSignals
      initialAppointmentTypes={[clinic]}
      appointment={externalAppointment}
      existingExternalAssignee={externalProfile}
    />)
    await screen.findByText('Share this patient from their profile to assign External Staff.')
    expect(screen.getByRole('combobox', { name: 'Assigned Staff' }).textContent).toContain('Existing assignment')
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Updated note' } })
    fireEvent.submit(screen.getByLabelText('Time *').closest('form')!)

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      external_profile_id: externalProfile.id,
      patient_id: patientA.id,
      notes: 'Updated note',
    })))
    expect(mocks.eq).toHaveBeenCalledWith('id', externalAppointment.id)
  })

  it('never requests patient grants from the Staff booking form', async () => {
    render(<AppointmentForm
      patients={[patientA]}
      canViewPaymentSignals={false}
      initialAppointmentTypes={[clinic]}
      defaultPatientId={patientA.id}
    />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Type' }).textContent).toContain('Clinic Visit'))
    expect(mocks.load).not.toHaveBeenCalled()
    expect(screen.queryByRole('combobox', { name: 'Assigned Staff' })).toBeNull()
  })
})
