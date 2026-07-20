import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  insert: vi.fn(),
  from: vi.fn(),
  toast: vi.fn(),
  loggerError: vi.fn(),
  referralSource: '' as '' | 'walk_in' | 'doctor' | 'other',
  resolveReferredDoctorId: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
    back: vi.fn(),
  }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mocks.from }),
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: mocks.loggerError,
  },
}))

vi.mock('@/components/referral/referral-fields', () => ({
  ReferralFields: () => null,
  useReferralSelection: () => ({
    referralSource: mocks.referralSource,
    resolveReferredDoctorId: mocks.resolveReferredDoctorId,
  }),
}))

import { PatientForm } from './patient-form'

describe('PatientForm submission', () => {
  beforeEach(() => {
    mocks.referralSource = ''
    mocks.resolveReferredDoctorId.mockResolvedValue({ doctorId: null })
    mocks.insert.mockResolvedValue({ error: null })
    mocks.from.mockImplementation((table: string) => {
      if (table !== 'patients') throw new Error(`Unexpected table: ${table}`)
      return { insert: mocks.insert }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('submits a new patient after asynchronous referral resolution', async () => {
    render(<PatientForm />)
    const nameInput = screen.getByLabelText('Name *')
    fireEvent.change(nameInput, { target: { value: 'Test Patient' } })
    fireEvent.submit(nameInput.closest('form')!)

    await waitFor(() => expect(mocks.insert).toHaveBeenCalledOnce())
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Test Patient',
      phone: null,
      referral_source: null,
      referred_by_doctor_id: null,
    }))
    expect(mocks.push).toHaveBeenCalledWith('/patients')
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('restores the form when the patient insert throws', async () => {
    mocks.insert.mockRejectedValueOnce(new Error('network unavailable'))
    render(<PatientForm />)
    const nameInput = screen.getByLabelText('Name *')
    fireEvent.change(nameInput, { target: { value: 'Test Patient' } })
    fireEvent.submit(nameInput.closest('form')!)

    await waitFor(() => {
      const submitButton = screen.getByRole('button', { name: 'Add Patient' }) as HTMLButtonElement
      expect(submitButton.disabled).toBe(false)
    })
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'PatientForm/save',
      expect.any(Error),
      { patientId: undefined },
    )
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Error',
      variant: 'destructive',
    }))
  })
})
