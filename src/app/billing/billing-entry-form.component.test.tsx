import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('./actions', () => ({ createBillingEntry: vi.fn(), recordPayment: vi.fn() }))

import { BillingEntryForm } from './billing-entry-form'

afterEach(cleanup)

describe('BillingEntryForm package contract', () => {
  it('requires type, independent start/payment dates, and package notes', () => {
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
    const notes = screen.getByLabelText('Notes *') as HTMLTextAreaElement
    expect(start.value).toBe('2026-08-15')
    expect(payment.value).toBe('2026-08-15')
    expect(start).not.toBe(payment)
    expect(notes.required).toBe(true)
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
    expect(screen.getByText('Regular allocation')).toBeTruthy()
  })
})
