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
    patient,
    appointments: [appointment],
    appointmentsTotalCount: 1,
    appointmentPage: 1,
    appointmentPageSize: 20,
    initialTab: 'appointments' as const,
    treatmentPlans: [],
    packages: [],
    payments: [],
    outstanding: 0,
    ...overrides,
  }
}

afterEach(cleanup)

describe('PatientDetail appointments tab count', () => {
  it('shows the total appointment count above the list', () => {
    render(<PatientDetail {...baseProps({ appointmentsTotalCount: 24 })} />)
    expect(screen.getByTestId('appointment-count').textContent).toBe('24 appointments')
  })

  it('singularises the count for a single appointment', () => {
    render(<PatientDetail {...baseProps({ appointmentsTotalCount: 1 })} />)
    expect(screen.getByTestId('appointment-count').textContent).toBe('1 appointment')
  })

  it('omits the count header when the patient has no appointments', () => {
    render(<PatientDetail {...baseProps({ appointments: [], appointmentsTotalCount: 0 })} />)
    expect(screen.queryByTestId('appointment-count')).toBeNull()
    expect(screen.getByText('No appointments yet.')).toBeTruthy()
  })
})
