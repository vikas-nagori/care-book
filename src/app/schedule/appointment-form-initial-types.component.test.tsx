import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  order: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mocks.from }),
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

vi.mock('@/components/referral/referral-fields', () => ({
  ReferralFields: () => null,
  useReferralSelection: () => ({
    referralSource: '',
    resolveReferredDoctorId: vi.fn(),
  }),
}))

import { AppointmentForm } from './appointment-form'

describe('AppointmentForm initial appointment types', () => {
  beforeEach(() => {
    mocks.order.mockResolvedValue({ data: [], error: null })
    mocks.select.mockReturnValue({ order: mocks.order })
    mocks.from.mockReturnValue({ select: mocks.select })
  })

  afterEach(() => {
    cleanup()
  })

  it('skips its appointment-types query when an empty initial array is provided', async () => {
    render(
      <AppointmentForm
        patients={[]}
        canViewPaymentSignals={false}
        initialAppointmentTypes={[]}
      />,
    )

    await waitFor(() => expect(mocks.from).not.toHaveBeenCalled())
  })

  it('retains the existing appointment-types query when initial types are omitted', async () => {
    render(<AppointmentForm patients={[]} canViewPaymentSignals={false} />)

    await waitFor(() => expect(mocks.from).toHaveBeenCalledWith('appointment_types'))
    expect(mocks.select).toHaveBeenCalledWith(
      'id, clinic_id, name, is_shared, is_default, sort_order, created_at',
    )
  })
})
