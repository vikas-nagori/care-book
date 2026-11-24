import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  updateEq: vi.fn(),
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
import type { Patient } from '@/lib/supabase/types'

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

describe('PatientForm age', () => {
  // Only Date is faked so testing-library's timers keep running. 06:00 UTC is 11:30 IST.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-24T06:00:00Z'))
    mocks.referralSource = ''
    mocks.resolveReferral.mockResolvedValue(noReferral)
    mocks.insert.mockResolvedValue({ error: null })
    mocks.updateEq.mockResolvedValue({ error: null })
    mocks.update.mockReturnValue({ eq: mocks.updateEq })
    mocks.from.mockImplementation(() => ({ insert: mocks.insert, update: mocks.update }))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  const existing = (overrides: Partial<Patient>) => ({
    id: 'patient-1', name: 'Asha Rao', phone: '9876500001', email: null, dob: null, age_years: null,
    age_recorded_on: null, gender: null, address: null, medical_history: null, notes: null,
    referral_source: null, referred_by_doctor_id: null, referred_by_patient_id: null, referral_other: null,
    ...overrides,
  }) as Patient

  function submitNew(age: string) {
    render(<PatientForm />)
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Aged Patient' } })
    fireEvent.change(screen.getByLabelText('Age (years)'), { target: { value: age } })
    fireEvent.submit(screen.getByLabelText('Name *').closest('form')!)
  }

  it('asks for age in years and no longer for a date of birth', () => {
    render(<PatientForm />)
    expect(screen.getByLabelText('Age (years)').getAttribute('inputmode')).toBe('numeric')
    expect(screen.queryByLabelText(/date of birth/i)).toBeNull()
  })

  it('records a new patient age against the IST day it was entered and never writes dob', async () => {
    submitNew('42')
    await waitFor(() => expect(mocks.insert).toHaveBeenCalledOnce())
    const payload = mocks.insert.mock.calls[0][0]
    expect(payload).toMatchObject({ name: 'Aged Patient', age_years: 42, age_recorded_on: '2026-11-24' })
    expect(payload).not.toHaveProperty('dob')
  })

  it('saves a new patient with the age left blank as unknown', async () => {
    submitNew('')
    await waitFor(() => expect(mocks.insert).toHaveBeenCalledOnce())
    expect(mocks.insert.mock.calls[0][0]).toMatchObject({ age_years: null, age_recorded_on: null })
  })

  it.each(['121', '-3', '4.5', 'forty'])('refuses an age of %s with a message and saves nothing', async (age) => {
    submitNew(age)
    expect((await screen.findByRole('alert')).textContent).toBe('Age must be a whole number between 0 and 120.')
    expect(screen.getByLabelText('Age (years)').getAttribute('aria-invalid')).toBe('true')
    expect(mocks.resolveReferral).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('clears the age message once the field is edited', async () => {
    submitNew('200')
    await screen.findByRole('alert')
    fireEvent.change(screen.getByLabelText('Age (years)'), { target: { value: '20' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows an existing date of birth as an age and leaves it untouched when the age is unchanged', async () => {
    render(<PatientForm patient={existing({ dob: '1990-03-10' })} />)
    const age = screen.getByLabelText('Age (years)') as HTMLInputElement
    expect(age.value).toBe('36')
    fireEvent.submit(age.closest('form')!)

    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce())
    const payload = mocks.update.mock.calls[0][0]
    expect(payload).not.toHaveProperty('dob')
    expect(payload).not.toHaveProperty('age_years')
    expect(payload).not.toHaveProperty('age_recorded_on')
    expect(mocks.updateEq).toHaveBeenCalledWith('id', 'patient-1')
  })

  it('keeps an earlier entered age anniversary when the shown age is unchanged', async () => {
    render(<PatientForm patient={existing({ age_years: 40, age_recorded_on: '2025-06-01' })} />)
    expect((screen.getByLabelText('Age (years)') as HTMLInputElement).value).toBe('41')
    fireEvent.submit(screen.getByLabelText('Name *').closest('form')!)

    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce())
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('age_years')
  })

  it('records a corrected age without touching the stored date of birth', async () => {
    render(<PatientForm patient={existing({ dob: '1990-03-10' })} />)
    fireEvent.change(screen.getByLabelText('Age (years)'), { target: { value: '50' } })
    fireEvent.submit(screen.getByLabelText('Name *').closest('form')!)

    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce())
    const payload = mocks.update.mock.calls[0][0]
    expect(payload).toMatchObject({ age_years: 50, age_recorded_on: '2026-11-24' })
    expect(payload).not.toHaveProperty('dob')
  })

  it('leaves the age blank for a patient with no age on record', () => {
    render(<PatientForm patient={existing({})} />)
    expect((screen.getByLabelText('Age (years)') as HTMLInputElement).value).toBe('')
  })
})
