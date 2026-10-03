import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  insert: vi.fn(),
  from: vi.fn(),
  toast: vi.fn(),
  loggerError: vi.fn(),
  referralSource: '' as '' | 'walk_in' | 'doctor' | 'google' | 'patient' | 'other',
  resolveReferral: vi.fn(),
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
    resolveReferral: mocks.resolveReferral,
  }),
}))

import { PatientForm } from './patient-form'

const noReferral = { referred_by_doctor_id: null, referred_by_patient_id: null, referral_other: null }

describe('PatientForm submission', () => {
  beforeEach(() => {
    mocks.referralSource = ''
    mocks.resolveReferral.mockResolvedValue(noReferral)
    mocks.insert.mockResolvedValue({ error: null })
    mocks.from.mockImplementation((table: string) => {
      if (table !== 'patients') throw new Error(`Unexpected table: ${table}`)
      return { insert: mocks.insert }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('associates the Gender label with its combobox trigger', () => {
    render(<PatientForm />)

    expect(screen.getByLabelText('Gender')).toBe(screen.getByRole('combobox', { name: 'Gender' }))
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
      referred_by_patient_id: null,
      referral_other: null,
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

  it('saves the resolved referring doctor', async () => {
    mocks.referralSource = 'doctor'
    mocks.resolveReferral.mockResolvedValueOnce({ ...noReferral, referred_by_doctor_id: 'doctor-1' })
    render(<PatientForm />)
    const nameInput = screen.getByLabelText('Name *')
    fireEvent.change(nameInput, { target: { value: 'Referred Patient' } })
    fireEvent.submit(nameInput.closest('form')!)

    await waitFor(() => expect(mocks.insert).toHaveBeenCalledOnce())
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Referred Patient',
      referral_source: 'doctor',
      referred_by_doctor_id: 'doctor-1',
    }))
  })

  it('saves the existing patient who referred them', async () => {
    mocks.referralSource = 'patient'
    mocks.resolveReferral.mockResolvedValueOnce({ ...noReferral, referred_by_patient_id: 'patient-9' })
    render(<PatientForm />)
    const nameInput = screen.getByLabelText('Name *')
    fireEvent.change(nameInput, { target: { value: 'Friend Of Asha' } })
    fireEvent.submit(nameInput.closest('form')!)

    await waitFor(() => expect(mocks.insert).toHaveBeenCalledOnce())
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      referral_source: 'patient',
      referred_by_doctor_id: null,
      referred_by_patient_id: 'patient-9',
      referral_other: null,
    }))
  })

  it('saves the typed source of an Other referral', async () => {
    mocks.referralSource = 'other'
    mocks.resolveReferral.mockResolvedValueOnce({ ...noReferral, referral_other: 'Instagram ad' })
    render(<PatientForm />)
    const nameInput = screen.getByLabelText('Name *')
    fireEvent.change(nameInput, { target: { value: 'Saw An Ad' } })
    fireEvent.submit(nameInput.closest('form')!)

    await waitFor(() => expect(mocks.insert).toHaveBeenCalledOnce())
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      referral_source: 'other',
      referral_other: 'Instagram ad',
    }))
  })

  it('does not save while the referral is incomplete', async () => {
    mocks.referralSource = 'patient'
    mocks.resolveReferral.mockResolvedValueOnce(null)
    render(<PatientForm />)
    const nameInput = screen.getByLabelText('Name *')
    fireEvent.change(nameInput, { target: { value: 'No Referrer Picked' } })
    fireEvent.submit(nameInput.closest('form')!)

    await waitFor(() => expect(mocks.resolveReferral).toHaveBeenCalledOnce())
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('restores the form when Supabase returns an insert error', async () => {
    const insertError = { message: 'Insert rejected' }
    mocks.insert.mockResolvedValueOnce({ error: insertError })
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
      insertError,
      { patientId: undefined },
    )
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Error',
      description: 'Insert rejected',
      variant: 'destructive',
    }))
  })

  it('restores the form when referral resolution fails before saving', async () => {
    mocks.resolveReferral.mockRejectedValueOnce(new Error('referral unavailable'))
    render(<PatientForm />)
    const nameInput = screen.getByLabelText('Name *')
    fireEvent.change(nameInput, { target: { value: 'Test Patient' } })
    fireEvent.submit(nameInput.closest('form')!)

    await waitFor(() => {
      const submitButton = screen.getByRole('button', { name: 'Add Patient' }) as HTMLButtonElement
      expect(submitButton.disabled).toBe(false)
    })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'PatientForm/submit',
      expect.any(Error),
      { patientId: undefined },
    )
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Error',
      description: 'Unable to save patient. Please try again.',
      variant: 'destructive',
    }))
  })

  it('allows retrying after a failed insert', async () => {
    mocks.insert
      .mockResolvedValueOnce({ error: { message: 'Temporary failure' } })
      .mockResolvedValueOnce({ error: null })
    render(<PatientForm />)
    const nameInput = screen.getByLabelText('Name *')
    fireEvent.change(nameInput, { target: { value: 'Retry Patient' } })
    const form = nameInput.closest('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      const submitButton = screen.getByRole('button', { name: 'Add Patient' }) as HTMLButtonElement
      expect(submitButton.disabled).toBe(false)
    })
    fireEvent.submit(form)

    await waitFor(() => expect(mocks.insert).toHaveBeenCalledTimes(2))
    expect(mocks.push).toHaveBeenCalledWith('/patients')
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
})
