import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { StaffAppointmentTypeOption } from '@/lib/dashboard/appointment-options'
import type { AppointmentType } from '@/lib/supabase/types'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  order: vi.fn(),
  toast: vi.fn(),
  createAppointment: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mocks.from }),
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))

vi.mock('./actions', () => ({
  createAppointment: mocks.createAppointment,
}))

vi.mock('@/components/referral/referral-fields', () => ({
  ReferralFields: () => null,
  useReferralSelection: () => ({
    referralSource: '',
    resolveReferredDoctorId: vi.fn(),
  }),
}))

import { AppointmentForm } from './appointment-form'

const fullAppointmentType: AppointmentType = {
  id: 'type-1',
  clinic_id: 'clinic-1',
  name: 'Clinic Visit',
  session_rate: 800,
  is_shared: true,
  is_default: true,
  sort_order: 1,
  created_at: '2026-01-01T00:00:00Z',
}

const staffSafeAppointmentTypes: StaffAppointmentTypeOption[] = [{
  id: fullAppointmentType.id,
  clinic_id: fullAppointmentType.clinic_id,
  name: fullAppointmentType.name,
  is_shared: fullAppointmentType.is_shared,
  is_default: fullAppointmentType.is_default,
  sort_order: fullAppointmentType.sort_order,
  created_at: fullAppointmentType.created_at,
}]

// @ts-expect-error Payment-visible forms require full appointment types with session rates.
const invalidPaymentVisibleProps: ComponentProps<typeof AppointmentForm> = {
  patients: [],
  canViewPaymentSignals: true,
  initialAppointmentTypes: staffSafeAppointmentTypes,
}
void invalidPaymentVisibleProps

describe('AppointmentForm initial appointment types', () => {
  beforeEach(() => {
    mocks.order.mockResolvedValue({ data: [], error: null })
    mocks.select.mockReturnValue({ order: mocks.order })
    mocks.from.mockReturnValue({ select: mocks.select })
    mocks.createAppointment.mockResolvedValue({
      success: true,
      appointmentIds: ['appointment-1'],
    })
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

  it('initializes the admin fee from a full default appointment type', async () => {
    render(
      <AppointmentForm
        patients={[]}
        canViewPaymentSignals={true}
        initialAppointmentTypes={[fullAppointmentType]}
      />,
    )

    await waitFor(() => {
      expect((screen.getByLabelText('Session Fee (₹)') as HTMLInputElement).value).toBe('800')
    })
  })

  it('fails safely instead of booking when a runtime caller omits an admin type rate', async () => {
    const unsafeProps = {
      patients: [{ id: 'patient-1', name: 'Patient One' }],
      defaultPatientId: 'patient-1',
      defaultDate: '2026-08-15',
      canViewPaymentSignals: true,
      initialAppointmentTypes: staffSafeAppointmentTypes,
    } as unknown as ComponentProps<typeof AppointmentForm>
    render(<AppointmentForm {...unsafeProps} />)

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Type' }).textContent).toContain('Clinic Visit')
    })
    const feeInput = screen.getByLabelText('Session Fee (₹)') as HTMLInputElement
    expect(feeInput.value).toBe('')
    fireEvent.submit(feeInput.closest('form')!)

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Session fee required',
      variant: 'destructive',
    })))
    expect(mocks.createAppointment).not.toHaveBeenCalled()
  })
})
