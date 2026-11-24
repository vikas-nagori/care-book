import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('./actions', () => ({
  createBillingEntry: vi.fn(),
  recordPayment: vi.fn(),
  // The form fetches the patient's outstanding charges to preview what a receipt settles.
  getOutstandingCharges: vi.fn(async () => ({ success: true, charges: [] })),
}))

import { BillingEntryForm } from './billing-entry-form'
import { getOutstandingCharges, recordPayment } from './actions'

afterEach(cleanup)

describe('BillingEntryForm package contract', () => {
  it('requires type and independent start/payment dates, but leaves package notes optional', () => {
    render(<BillingEntryForm
      patients={[{ id: 'p1', name: 'Asha' }]}
      appointmentTypes={[{ id: 'clinic', name: 'Clinic', session_rate: 800 }]}
      defaultPaymentDate="2026-08-15"
      clinicToday="2026-08-15"
    />)
    fireEvent.click(screen.getByRole('button', { name: /Package \+ payment/i }))
    expect(screen.getByLabelText('Appointment Type *')).toBeTruthy()
    const start = screen.getByLabelText('Package Start Date *') as HTMLInputElement
    const payment = screen.getByLabelText('Payment Date *') as HTMLInputElement
    const notes = screen.getByLabelText('Notes') as HTMLTextAreaElement
    expect(start.value).toBe('2026-08-15')
    expect(payment.value).toBe('2026-08-15')
    expect(start).not.toBe(payment)
    expect(notes.required).toBe(false)
  })

  it('scopes every standalone receipt to regular funds with no scope picker', () => {
    render(<BillingEntryForm
      patients={[{ id: 'p1', name: 'Asha' }]}
      appointmentTypes={[]}
      defaultPaymentDate="2026-08-15"
      clinicToday="2026-08-15"
    />)
    fireEvent.click(screen.getByLabelText('Patient *'))
    fireEvent.click(screen.getByRole('button', { name: 'Asha' }))
    fireEvent.change(screen.getByLabelText('Amount Received *'), { target: { value: '500' } })
    expect(screen.queryByLabelText('Funding Scope *')).toBeNull()
    expect(screen.queryByLabelText('Package *')).toBeNull()
    expect(screen.getByText('What this payment settles')).toBeTruthy()
  })

  it('previews the sessions a receipt settles, partial coverage included', async () => {
    vi.mocked(getOutstandingCharges).mockResolvedValueOnce({
      success: true,
      charges: [
        { appointmentId: 'a1', date: '2026-07-22', time: '10:00:00', type: 'Clinic', chargeAmount: 650, remainingAmount: 650 },
        { appointmentId: 'a2', date: '2026-08-05', time: '10:00:00', type: 'Clinic', chargeAmount: 650, remainingAmount: 650 },
      ],
    })

    render(<BillingEntryForm
      patients={[{ id: 'p1', name: 'Asha' }]}
      appointmentTypes={[]}
      defaultPaymentDate="2026-08-15"
      clinicToday="2026-08-15"
    />)
    fireEvent.click(screen.getByLabelText('Patient *'))
    fireEvent.click(screen.getByRole('button', { name: 'Asha' }))
    fireEvent.change(screen.getByLabelText('Amount Received *'), { target: { value: '850' } })

    // Oldest session in full, then the remainder against the next one — what the ledger does.
    expect(await screen.findByText('22 Jul 2026')).toBeTruthy()
    expect(screen.getByText('05 Aug 2026')).toBeTruthy()
    expect(screen.getByText(/of/)).toBeTruthy()
    expect(screen.getByText(/across 2 sessions, oldest first/)).toBeTruthy()
  })

  it('says so plainly when a receipt has no sessions to settle', async () => {
    vi.mocked(getOutstandingCharges).mockResolvedValueOnce({ success: true, charges: [] })

    render(<BillingEntryForm
      patients={[{ id: 'p1', name: 'Asha' }]}
      appointmentTypes={[]}
      defaultPaymentDate="2026-08-15"
      clinicToday="2026-08-15"
    />)
    fireEvent.click(screen.getByLabelText('Patient *'))
    fireEvent.click(screen.getByRole('button', { name: 'Asha' }))
    fireEvent.change(screen.getByLabelText('Amount Received *'), { target: { value: '500' } })

    expect(await screen.findByText(/stays as\s+refundable credit/)).toBeTruthy()
  })

  it('locks the package receipt to the full package total', () => {
    render(<BillingEntryForm
      patients={[{ id: 'p1', name: 'Asha' }]}
      appointmentTypes={[{ id: 'clinic', name: 'Clinic', session_rate: 800 }]}
      defaultPaymentDate="2026-08-15"
      clinicToday="2026-08-15"
    />)
    fireEvent.click(screen.getByLabelText('Patient *'))
    fireEvent.click(screen.getByRole('button', { name: 'Asha' }))
    fireEvent.change(screen.getByLabelText('Amount Received *'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: /Package \+ payment/i }))

    const amount = screen.getByLabelText('Amount Received *') as HTMLInputElement
    // Switching to package mode drops the standalone amount in favour of the derived total.
    expect(amount.readOnly).toBe(true)
    expect(amount.value).toBe('')

    fireEvent.change(screen.getByLabelText('Sessions *'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Per Session *'), { target: { value: '540' } })
    expect(amount.value).toBe('5400')
  })

  it('leaves Save clickable so the browser prompts on the field that drives the total', () => {
    render(<BillingEntryForm
      patients={[{ id: 'p1', name: 'Asha' }]}
      appointmentTypes={[{ id: 'clinic', name: 'Clinic', session_rate: 800 }]}
      defaultPaymentDate="2026-08-15"
      clinicToday="2026-08-15"
    />)
    fireEvent.click(screen.getByLabelText('Patient *'))
    fireEvent.click(screen.getByRole('button', { name: 'Asha' }))
    fireEvent.click(screen.getByRole('button', { name: /Package \+ payment/i }))

    // A disabled button would explain nothing; native validation names the missing field instead.
    expect(screen.getByRole('button', { name: 'Save Package' })).toHaveProperty('disabled', false)
    const sessions = screen.getByLabelText('Sessions *') as HTMLInputElement
    const rate = screen.getByLabelText('Per Session *') as HTMLInputElement
    expect(sessions.required).toBe(true)
    expect(rate.required).toBe(true)
    // Their bounds are what guarantee a positive total once validation passes.
    expect(sessions.min).toBe('1')
    expect(rate.min).toBe('0.01')
    expect(sessions.checkValidity()).toBe(false)
  })
})

describe('BillingEntryForm double submission (G-14)', () => {
  function renderPaymentForm() {
    render(<BillingEntryForm
      patients={[{ id: 'p1', name: 'Asha' }]}
      appointmentTypes={[]}
      defaultPaymentDate="2026-08-15"
      clinicToday="2026-08-15"
    />)
    fireEvent.click(screen.getByLabelText('Patient *'))
    fireEvent.click(screen.getByRole('button', { name: 'Asha' }))
    fireEvent.change(screen.getByLabelText('Amount Received *'), { target: { value: '500' } })
    return screen.getByRole('button', { name: 'Save Payment' }) as HTMLButtonElement
  }

  it('records once when Save is activated twice before React re-renders', async () => {
    let finish!: (value: Awaited<ReturnType<typeof recordPayment>>) => void
    vi.mocked(recordPayment).mockReset().mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const save = renderPaymentForm()

    // Both activations inside one act(): the disabled state is not committed between them.
    act(() => {
      save.click()
      save.click()
    })
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(1))
    await act(async () => finish({ success: true, paymentId: 'pay-1', linkedAppointmentIds: [], updatedPackageId: null }))
    expect(recordPayment).toHaveBeenCalledTimes(1)
  })

  it('resends the same input with the same request key, and a changed input with a new one', async () => {
    vi.mocked(recordPayment).mockReset().mockResolvedValue({ success: false, errorCode: 'X', message: 'Network trouble' })
    const save = renderPaymentForm()

    fireEvent.click(save)
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('Amount Received *'), { target: { value: '600' } })
    fireEvent.click(save)
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(3))

    const keys = vi.mocked(recordPayment).mock.calls.map(([input]) => input.requestKey)
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })
})
