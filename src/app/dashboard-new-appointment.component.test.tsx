import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import type { DashboardAppointmentOptionsResult } from '@/lib/dashboard/appointment-options'

const mocks = vi.hoisted(() => ({
  getOptions: vi.fn(),
  appointmentForm: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('./dashboard-actions', () => ({
  getDashboardAppointmentOptions: mocks.getOptions,
}))

vi.mock('./schedule/appointment-form', () => ({
  AppointmentForm: (props: Record<string, unknown>) => {
    mocks.appointmentForm(props)
    return <div data-testid="appointment-form">Appointment form ready</div>
  },
}))

import { DashboardNewAppointmentButton } from './dashboard-new-appointment'

const successResult: DashboardAppointmentOptionsResult = {
  ok: true,
  data: {
    patients: [{ id: 'patient-1', name: 'Patient One' }],
    doctors: [{
      id: 'doctor-1',
      clinic_id: 'clinic-1',
      name: 'Doctor One',
      specialty: null,
      address: null,
      created_by: 'admin-1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }],
    assigneeOptions: [{
      id: 'staff-1',
      email: 'staff@example.test',
      role: 'staff',
      full_name: 'Staff One',
    }],
    externalStaffOptions: [{
      id: 'external-1',
      clinic_id: 'clinic-1',
      name: 'External One',
      phone: '9999999999',
      email: null,
      notes: null,
      status: 'active',
      linked_profile_id: null,
      created_by: 'admin-1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }],
    appointmentTypes: [{
      id: 'type-1',
      clinic_id: 'clinic-1',
      name: 'Clinic Visit',
      session_rate: 800,
      is_shared: true,
      is_default: true,
      sort_order: 1,
      created_at: '2026-01-01T00:00:00Z',
    }],
    currentProfileId: 'admin-1',
    canManageExternalStaff: true,
    canViewPaymentSignals: true,
  },
}

const retryableFailure: DashboardAppointmentOptionsResult = {
  ok: false,
  code: 'load_failed',
  message: 'Unable to load appointment options.',
  retryable: true,
}

function deferredResult() {
  let resolve!: (value: DashboardAppointmentOptionsResult) => void
  const promise = new Promise<DashboardAppointmentOptionsResult>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('DashboardNewAppointmentButton', () => {
  beforeEach(() => {
    mocks.getOptions.mockResolvedValue(successResult)
  })

  afterEach(() => {
    cleanup()
  })

  it('does not fetch before opening and fetches exactly once on first open', async () => {
    render(<DashboardNewAppointmentButton defaultDate="2026-08-15" />)

    expect(mocks.getOptions).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'New appointment' }))

    await waitFor(() => expect(mocks.getOptions).toHaveBeenCalledOnce())
  })

  it('accepts the active request after React Strict Mode replays the mount effect', async () => {
    render(
      <StrictMode>
        <DashboardNewAppointmentButton defaultDate="2026-08-15" />
      </StrictMode>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'New appointment' }))

    expect(await screen.findByTestId('appointment-form')).not.toBeNull()
  })

  it('shows an accessible loading state while the options request is pending', async () => {
    const request = deferredResult()
    mocks.getOptions.mockReturnValueOnce(request.promise)
    render(<DashboardNewAppointmentButton defaultDate="2026-08-15" />)

    fireEvent.click(screen.getByRole('button', { name: 'New appointment' }))

    expect((await screen.findByRole('status')).textContent).toContain('Loading appointment options')
    expect(screen.queryByTestId('appointment-form')).toBeNull()
    request.resolve(successResult)
  })

  it('renders the form only after the complete payload succeeds', async () => {
    render(<DashboardNewAppointmentButton defaultDate="2026-08-15" />)

    fireEvent.click(screen.getByRole('button', { name: 'New appointment' }))

    expect(await screen.findByTestId('appointment-form')).not.toBeNull()
    expect(mocks.appointmentForm).toHaveBeenCalledWith(expect.objectContaining({
      patients: successResult.ok ? successResult.data.patients : [],
      doctors: successResult.ok ? successResult.data.doctors : [],
      assigneeOptions: successResult.ok ? successResult.data.assigneeOptions : [],
      externalStaffOptions: successResult.ok ? successResult.data.externalStaffOptions : [],
      initialAppointmentTypes: successResult.ok ? successResult.data.appointmentTypes : [],
      currentProfileId: 'admin-1',
      canManageExternalStaff: true,
      canViewPaymentSignals: true,
      defaultDate: '2026-08-15',
    }))
  })

  it('shows a generic error and retries the full request', async () => {
    mocks.getOptions
      .mockResolvedValueOnce(retryableFailure)
      .mockResolvedValueOnce(successResult)
    render(<DashboardNewAppointmentButton defaultDate="2026-08-15" />)

    fireEvent.click(screen.getByRole('button', { name: 'New appointment' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Unable to load appointment options.')
    expect(screen.queryByTestId('appointment-form')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByTestId('appointment-form')).not.toBeNull()
    expect(mocks.getOptions).toHaveBeenCalledTimes(2)
  })

  it('caches successful options and reuses them after closing and reopening', async () => {
    render(<DashboardNewAppointmentButton defaultDate="2026-08-15" />)
    fireEvent.click(screen.getByRole('button', { name: 'New appointment' }))
    expect(await screen.findByTestId('appointment-form')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByTestId('appointment-form')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'New appointment' }))

    expect(await screen.findByTestId('appointment-form')).not.toBeNull()
    expect(mocks.getOptions).toHaveBeenCalledOnce()
  })
})
