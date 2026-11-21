import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AppointmentType } from '@/lib/supabase/types'

const mocks = vi.hoisted(() => ({ load: vi.fn(), rpc: vi.fn() }))
vi.mock('./external-assignees', () => ({ getExternalAssigneeOptions: mocks.load }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/lib/observability/report-booking-event', () => ({ reportBookingEvent: vi.fn() }))
vi.mock('@/components/referral/referral-fields', () => ({
  ReferralFields: () => null,
  useReferralSelection: () => ({ referralSource: '' }),
}))

import { AppointmentForm } from './appointment-form'

const patientA = { id: '11111111-1111-4111-8111-111111111111', name: 'Patient One' }
const patientB = { id: '22222222-2222-4222-8222-222222222222', name: 'Patient Two' }
const clinic: AppointmentType = {
  id: '33333333-3333-4333-8333-333333333333', clinic_id: 'clinic', name: 'Clinic Visit',
  session_rate: 800, is_shared: true, is_default: true, sort_order: 0, created_at: '',
}
const home: AppointmentType = {
  ...clinic,
  id: '44444444-4444-4444-8444-444444444444', name: 'Home Visit', is_shared: false, is_default: false, sort_order: 1,
}
const assignees = [
  { id: 'admin-1', full_name: 'Clinic Admin', email: 'admin@example.test', role: 'admin' as const },
  { id: 'staff-1', full_name: 'Staff Member', email: 'staff@example.test', role: 'staff' as const },
]

function choose(name: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name }), { key: 'Enter' })
  fireEvent.click(screen.getByRole('option', { name: option }))
}

function fee() {
  return (screen.getByLabelText('Session Fee (₹)') as HTMLInputElement).value
}

describe('AppointmentForm booking defaults', () => {
  beforeEach(() => {
    mocks.load.mockResolvedValue({ ok: true, profiles: [] })
    mocks.rpc.mockImplementation(async (_name: string, args: { p_patient_id: string }) => ({
      data: args.p_patient_id === patientA.id ? 1200 : 800,
      error: null,
    }))
  })
  afterEach(cleanup)

  it('assigns a restricted-type booking to whoever is booking, from the first render', async () => {
    render(<AppointmentForm
      patients={[patientA]}
      canViewPaymentSignals={false}
      initialAppointmentTypes={[{ ...home, is_default: true }]}
      assigneeOptions={assignees}
      currentProfileId="staff-1"
    />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Assigned Staff' }).textContent).toContain('Staff Member'))
  })

  it('keeps the booker as the default when an admin switches to a restricted type', async () => {
    render(<AppointmentForm
      patients={[patientA]}
      canManageExternalStaff
      canViewPaymentSignals
      initialAppointmentTypes={[clinic, home]}
      assigneeOptions={assignees}
      currentProfileId="admin-1"
    />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Type' }).textContent).toContain('Clinic Visit'))
    choose('Type', 'Home Visit')
    expect(screen.getByRole('combobox', { name: 'Assigned Staff' }).textContent).toContain('Clinic Admin')
  })

  it("prefills an admin's fee from the patient's last session of the type and falls back on patient change", async () => {
    render(<AppointmentForm
      patients={[patientA, patientB]}
      canViewPaymentSignals
      initialAppointmentTypes={[clinic, home]}
      defaultPatientId={patientA.id}
      assigneeOptions={assignees}
      currentProfileId="admin-1"
    />)
    await waitFor(() => expect(fee()).toBe('1200'))
    expect(mocks.rpc).toHaveBeenCalledWith('suggest_appointment_fee', {
      p_patient_id: patientA.id,
      p_appointment_type_id: clinic.id,
    })
    expect(screen.getByText(/last Clinic Visit session/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Patient *'), { target: { value: 'Two' } })
    fireEvent.click(screen.getByRole('button', { name: 'Patient Two' }))
    await waitFor(() => expect(fee()).toBe('800'))
    expect(screen.queryByText(/last Clinic Visit session/)).toBeNull()
  })

  it('never overwrites a fee the admin typed', async () => {
    let resolve: (value: { data: number; error: null }) => void = () => {}
    mocks.rpc.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    render(<AppointmentForm
      patients={[patientA]}
      canViewPaymentSignals
      initialAppointmentTypes={[clinic]}
      defaultPatientId={patientA.id}
    />)
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Session Fee (₹)'), { target: { value: '500' } })
    resolve({ data: 1200, error: null })
    await new Promise((done) => setTimeout(done, 0))
    expect(fee()).toBe('500')
  })

  it('never asks for or shows a fee to Staff', async () => {
    render(<AppointmentForm
      patients={[patientA]}
      canViewPaymentSignals={false}
      initialAppointmentTypes={[{ id: clinic.id, clinic_id: 'clinic', name: 'Clinic Visit', is_shared: true, is_default: true, sort_order: 0, created_at: '' }]}
      defaultPatientId={patientA.id}
    />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Type' }).textContent).toContain('Clinic Visit'))
    expect(screen.queryByLabelText('Session Fee (₹)')).toBeNull()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
