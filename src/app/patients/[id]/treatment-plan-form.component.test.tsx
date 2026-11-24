import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: () => ({ insert: mocks.insert }) }),
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))

import { TreatmentPlanForm } from './treatment-plan-form'
import { NETWORK_ERROR_MESSAGE } from '@/lib/actions/request-error-message'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function submit() {
  const diagnosis = document.querySelector('input[name="diagnosis"]') as HTMLInputElement
  fireEvent.change(diagnosis, { target: { value: 'Frozen shoulder' } })
  fireEvent.submit(diagnosis.closest('form')!)
}

describe('TreatmentPlanForm failures', () => {
  it('re-enables Create Plan and says why when the client throws (G-7)', async () => {
    mocks.insert.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const onSuccess = vi.fn()
    render(<TreatmentPlanForm patientId="patient-1" defaultDate="2026-11-24" onSuccess={onSuccess} />)
    submit()

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Plan not saved',
      description: NETWORK_ERROR_MESSAGE,
      variant: 'destructive',
    })))
    expect((screen.getByRole('button', { name: 'Create Plan' }) as HTMLButtonElement).disabled).toBe(false)
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('creates the plan once the retry succeeds', async () => {
    mocks.insert.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ error: null })
    const onSuccess = vi.fn()
    render(<TreatmentPlanForm patientId="patient-1" defaultDate="2026-11-24" onSuccess={onSuccess} />)
    submit()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create Plan' }) as HTMLButtonElement).disabled).toBe(false))
    submit()
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    expect(mocks.insert).toHaveBeenCalledTimes(2)
  })
})
