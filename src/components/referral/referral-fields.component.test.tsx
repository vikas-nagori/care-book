import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ toast: vi.fn() }))

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: vi.fn() }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

import {
  REFERRAL_SOURCE_LABEL,
  ReferralFields,
  useReferralSelection,
  type ReferralSelection,
} from './referral-fields'
import type { ReferralSource } from '@/lib/supabase/types'

const patients = [
  { id: 'p-asha', name: 'Asha Rao', phone: '9000000001' },
  { id: 'p-ravi', name: 'Ravi Kumar', phone: '9000000002' },
  { id: 'p-self', name: 'Self Patient', phone: '9000000003' },
]

// The hook's latest return value, captured after each render so tests can drive it.
const captured: { current: ReferralSelection | null } = { current: null }
const latest = () => captured.current!

function Harness(props: {
  initial?: Parameters<typeof useReferralSelection>[0]
  excludePatientId?: string
}) {
  const referral = useReferralSelection(props.initial)
  useEffect(() => {
    captured.current = referral
  })
  return <ReferralFields referral={referral} doctors={[]} patients={patients} excludePatientId={props.excludePatientId} />
}

function chooseSource(source: ReferralSource) {
  act(() => latest().handleReferralSourceChange(source))
}

beforeEach(() => mocks.toast.mockReset())
afterEach(cleanup)

describe('referral sources', () => {
  it('offers Google page and existing-patient referrals alongside the original sources', () => {
    expect(Object.values(REFERRAL_SOURCE_LABEL)).toEqual([
      'Walk-in',
      'Referred by doctor',
      'Google page',
      'Referred by existing patient',
      'Other',
    ])
  })

  it('records a Google page referral with no further detail', async () => {
    render(<Harness />)
    chooseSource('google')
    expect(screen.queryByLabelText('Referring Patient')).toBeNull()
    expect(screen.queryByLabelText('Please specify')).toBeNull()
    await expect(latest().resolveReferral()).resolves.toEqual({
      referred_by_doctor_id: null,
      referred_by_patient_id: null,
      referral_other: null,
    })
  })
})

describe('referred by an existing patient', () => {
  it('searches the existing patients and records the one picked', async () => {
    render(<Harness />)
    chooseSource('patient')

    fireEvent.click(screen.getByLabelText('Referring Patient'))
    fireEvent.change(screen.getByPlaceholderText('Search patient name…'), { target: { value: 'rav' } })
    expect(screen.queryByRole('button', { name: /Asha Rao/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Ravi Kumar/ }))

    await expect(latest().resolveReferral()).resolves.toEqual({
      referred_by_doctor_id: null,
      referred_by_patient_id: 'p-ravi',
      referral_other: null,
    })
  })

  it('does not offer the patient being edited as their own referrer', () => {
    render(<Harness excludePatientId="p-self" />)
    chooseSource('patient')
    fireEvent.click(screen.getByLabelText('Referring Patient'))
    expect(screen.getByRole('button', { name: /Asha Rao/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Self Patient/ })).toBeNull()
  })

  it('refuses to save until a referring patient is picked', async () => {
    render(<Harness />)
    chooseSource('patient')
    await expect(latest().resolveReferral()).resolves.toBeNull()
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Referring patient required' }))
  })

  it('shows the saved referrer when editing', () => {
    render(<Harness initial={{ source: 'patient', referrerPatientId: 'p-asha' }} />)
    expect(screen.getByLabelText('Referring Patient').textContent).toContain('Asha Rao')
  })
})

describe('other referrals', () => {
  it('lets the source be typed and records it trimmed', async () => {
    render(<Harness />)
    chooseSource('other')
    fireEvent.change(screen.getByLabelText('Please specify'), { target: { value: '  Instagram ad  ' } })
    await expect(latest().resolveReferral()).resolves.toEqual({
      referred_by_doctor_id: null,
      referred_by_patient_id: null,
      referral_other: 'Instagram ad',
    })
  })

  it('still saves an Other referral left blank', async () => {
    render(<Harness />)
    chooseSource('other')
    await expect(latest().resolveReferral()).resolves.toMatchObject({ referral_other: null })
  })

  it('prefills the typed source when editing', () => {
    render(<Harness initial={{ source: 'other', other: 'Society health camp' }} />)
    expect((screen.getByLabelText('Please specify') as HTMLInputElement).value).toBe('Society health camp')
  })
})

describe('switching source', () => {
  it('drops the detail that belonged to the previous source', async () => {
    render(<Harness initial={{ source: 'other', other: 'Instagram ad' }} />)
    chooseSource('patient')
    fireEvent.click(screen.getByLabelText('Referring Patient'))
    fireEvent.click(screen.getByRole('button', { name: /Asha Rao/ }))
    chooseSource('google')
    await expect(latest().resolveReferral()).resolves.toEqual({
      referred_by_doctor_id: null,
      referred_by_patient_id: null,
      referral_other: null,
    })
  })
})
