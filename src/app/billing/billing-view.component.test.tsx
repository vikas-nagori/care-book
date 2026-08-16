import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { BillingTimelinePackage, BillingTimelinePayment } from '@/lib/billing/unified-billing'

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
  cancelPackage: vi.fn(),
  voidPayment: vi.fn(),
  recordRefund: vi.fn(),
  voidRefund: vi.fn(),
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
    appointment_type_id: 'type-1',
    starts_on: '2026-07-20',
    completed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    cancelled_by: null,
    billing_version: 2,
    // Real Supabase timestamptz — a full ISO timestamp, not a bare date key.
    created_at: '2026-07-20T10:30:00.123456+00:00',
    patient: { id: 'patient-1', name: 'Asha Rao' },
    ...overrides,
  }
}

function makePayment(overrides: Partial<BillingTimelinePayment> = {}): BillingTimelinePayment {
  return {
    id: 'payment-1', clinic_id: 'clinic-1', patient_id: 'patient-1', package_id: null, appointment_id: null,
    amount: 1000, payment_method: 'upi', date: '2026-07-20', notes: null,
    funding_scope: 'ordinary', status: 'posted', billing_version: 2,
    created_at: '2026-07-20T10:30:00Z', patient: { id: 'patient-1', name: 'Asha Rao' }, package: null,
    ...overrides,
  }
}

const baseProps = {
  packagesTotalCount: 1,
  packageTemplates: [],
  appointmentTypes: [],
  payments: [],
  paymentsTotalCount: 0,
  pageSize: 20,
  patients: [{ id: 'patient-1', name: 'Asha Rao' }],
  linkedSessionCounts: {},
  packageBalances: {
    'pkg-1': {
      package_id: 'pkg-1', clinic_id: 'clinic-1', patient_id: 'patient-1', name: '10-session package',
      appointment_type_id: 'type-1', starts_on: '2026-07-20', quote_amount: 8000,
      net_received: 8000, applied_amount: 2400, due_amount: 0, refundable_credit: 5600,
      availed_sessions: 3, scheduled_sessions: 2, remaining_sessions: 5,
      lifecycle: 'active' as const, completed_at: null, cancelled_at: null, cancellation_reason: null,
    },
  },
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
    expect(screen.getByText('3 availed · 2 scheduled · 10 total')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Delete package/i })).toBeNull()
    expect(screen.getByRole('button', { name: /Cancel package/i })).toBeTruthy()
  })

  it('shows audited receipt status for partial refunds and voids', () => {
    render(<BillingView
      {...baseProps}
      packages={[makePackage()]}
      payments={[makePayment(), makePayment({ id: 'payment-2', status: 'voided', amount: 500 })]}
      refunds={[{ id: 'refund-1', payment_id: 'payment-1', amount: 200, refund_method: 'upi', refund_date: '2026-07-21', reason: 'Correction', reversed: false }]}
      initialTab="payments"
    />)
    expect(screen.getAllByText('Partially refunded').length).toBeGreaterThan(0)
    // 'voided' in the DB reads as 'Cancelled' to the clinic.
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0)
    expect(screen.queryByText('Voided')).toBeNull()
  })

  it('labels an unrefunded receipt Received rather than Posted', () => {
    render(<BillingView {...baseProps} packages={[]} payments={[makePayment()]} initialTab="payments" />)
    expect(screen.getAllByText('Received').length).toBeGreaterThan(0)
    expect(screen.queryByText('Posted')).toBeNull()
  })
})
