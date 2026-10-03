import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import type { Patient } from '@/lib/supabase/types'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  back: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, back: mocks.back, push: vi.fn() }),
}))

// Treatment-plan form pulls in a server action; stub it — the appointments tab never renders it.
vi.mock('./treatment-plan-form', () => ({
  TreatmentPlanForm: () => null,
}))

import { PatientDetail } from './patient-detail'

const patient: Patient = {
  id: 'patient-1',
  clinic_id: 'clinic-1',
  name: 'Asha Rao',
  phone: '9876500001',
  email: null,
  address: null,
  dob: null,
  gender: null,
  medical_history: null,
  notes: null,
  referral_source: null,
  referred_by_doctor: null,
  created_at: '2026-07-01T00:00:00Z',
} as unknown as Patient

const appointment = {
  id: 'appt-1',
  date: '2026-07-10',
  time: '09:00',
  duration_minutes: 45,
  type: 'clinic',
  status: 'completed' as const,
}

function baseProps(overrides: Partial<React.ComponentProps<typeof PatientDetail>> = {}) {
  return {
    defaultDate: '2026-07-21',
    canViewBilling: false,
    isAdmin: false,
    patient,
    appointments: [appointment],
    appointmentsTotalCount: 1,
    appointmentsActiveCount: 1,
    appointmentPage: 1,
    appointmentPageSize: 20,
    initialTab: 'appointments' as const,
    treatmentPlans: [],
    packages: [],
    payments: [],
    patientBalance: null,
    packageBalances: {},
    ...overrides,
  }
}

afterEach(cleanup)

describe('PatientDetail appointments tab count', () => {
  it('shows the active (non-cancelled) appointment count above the list', () => {
    render(<PatientDetail {...baseProps({ appointmentsActiveCount: 24 })} />)
    expect(screen.getByTestId('appointment-count').textContent).toBe('24 appointments')
  })

  it('singularises the count for a single appointment', () => {
    render(<PatientDetail {...baseProps({ appointmentsActiveCount: 1 })} />)
    expect(screen.getByTestId('appointment-count').textContent).toBe('1 appointment')
  })

  it('counts only active appointments even when cancelled ones are listed', () => {
    // total includes cancelled (drives pagination); active excludes them (drives the label)
    render(
      <PatientDetail
        {...baseProps({ appointmentsTotalCount: 5, appointmentsActiveCount: 3 })}
      />,
    )
    expect(screen.getByTestId('appointment-count').textContent).toBe('3 appointments')
  })

  it('omits the count header when the patient has no active appointments', () => {
    // cancelled-only patient: list still renders a row, but the label is hidden
    render(
      <PatientDetail
        {...baseProps({ appointmentsTotalCount: 2, appointmentsActiveCount: 0 })}
      />,
    )
    expect(screen.queryByTestId('appointment-count')).toBeNull()
  })

  it('omits the count header when the patient has no appointments', () => {
    render(<PatientDetail {...baseProps({ appointments: [], appointmentsTotalCount: 0, appointmentsActiveCount: 0 })} />)
    expect(screen.queryByTestId('appointment-count')).toBeNull()
    expect(screen.getByText('No appointments yet.')).toBeTruthy()
  })
})

describe('PatientDetail delete button gating', () => {
  it('shows the Delete button for admins', () => {
    render(<PatientDetail {...baseProps({ isAdmin: true })} />)
    expect(screen.getAllByRole('button', { name: /delete/i }).length).toBeGreaterThan(0)
  })

  it('hides the Delete button for non-admins', () => {
    render(<PatientDetail {...baseProps({ isAdmin: false })} />)
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
  })
})

describe('PatientDetail referral', () => {
  it('names the existing patient who referred them, linking to their record', () => {
    const referred = { ...patient, referral_source: 'patient', referred_by_patient_id: 'patient-2', referred_by_patient: { id: 'patient-2', name: 'Ravi Kumar' } } as unknown as Patient
    render(<PatientDetail {...baseProps({ patient: referred, initialTab: 'profile' })} />)
    expect(screen.getAllByText('Referred by existing patient').length).toBeGreaterThan(0)
    const link = screen.getAllByRole('link', { name: 'Ravi Kumar' })[0]
    expect(link.getAttribute('href')).toBe('/patients/patient-2')
  })

  it('shows the typed source of an Other referral', () => {
    const other = { ...patient, referral_source: 'other', referral_other: 'Instagram ad' } as unknown as Patient
    render(<PatientDetail {...baseProps({ patient: other, initialTab: 'profile' })} />)
    expect(screen.getAllByText('Other').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Instagram ad').length).toBeGreaterThan(0)
  })

  it('labels a Google page referral', () => {
    const google = { ...patient, referral_source: 'google' } as unknown as Patient
    render(<PatientDetail {...baseProps({ patient: google, initialTab: 'profile' })} />)
    expect(screen.getAllByText('Google page').length).toBeGreaterThan(0)
  })
})
