import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { BillingTimelinePackage } from '@/lib/billing/unified-billing'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  from: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh, back: vi.fn() }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mocks.from }),
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))

vi.mock('./actions', () => ({
  deletePackage: vi.fn(),
  deletePayment: vi.fn(),
}))

vi.mock('./billing-entry-form', () => ({
  BillingEntryForm: () => null,
}))

import { BillingView } from './billing-view'

function makePackage(overrides: Partial<BillingTimelinePackage> = {}): BillingTimelinePackage {
  return {
    id: 'pkg-1',
    clinic_id: 'clinic-1',
    patient_id: 'patient-1',
    name: '10-session package',
    total_sessions: 10,
    used_sessions: 3,
    total_amount: 8000,
    per_session_amount: 800,
    paid_amount: 8000,
    payment_timing: 'prepaid',
    status: 'active',
    // Real Supabase timestamptz — a full ISO timestamp, not a bare date key.
    created_at: '2026-07-20T10:30:00.123456+00:00',
    patient: { id: 'patient-1', name: 'Asha Rao' },
    ...overrides,
  }
}

const baseProps = {
  packagesTotalCount: 1,
  packageTemplates: [],
  payments: [],
  paymentsTotalCount: 0,
  pageSize: 20,
  patients: [{ id: 'patient-1', name: 'Asha Rao' }],
  appointments: [],
  linkedSessionCounts: {},
  patientCredit: {},
  paymentDueRows: [],
  billedThisMonth: 0,
  billedLastMonth: 0,
  billedLastMonthLabel: 'Jun 2026',
  currentMonthLabel: 'Jul 2026',
  defaultPaymentDate: '2026-07-20',
  clinicToday: '2026-07-20',
  receivedThisMonth: 0,
  initialEntryOpen: false,
}

describe('BillingView packages tab', () => {
  it('renders a package whose created_at is a full timestamp without crashing', () => {
    render(
      <BillingView
        {...baseProps}
        packages={[makePackage()]}
        initialTab="packages"
      />,
    )

    // Package details render…
    expect(screen.getByText('Asha Rao')).toBeTruthy()
    expect(screen.getByText('10-session package')).toBeTruthy()
    // …and the created_at timestamp is formatted (regression: this used to throw
    // "Invalid calendar date" and crash the whole page).
    expect(screen.getByText('20 Jul 2026')).toBeTruthy()
  })
})
