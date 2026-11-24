import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))

vi.mock('../actions', () => ({ savePatientExternalAccess: mocks.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

import { PatientExternalAccess } from './patient-external-access'

const profiles = [
  { id: 'alex', full_name: 'Alex Rao', email: 'alex@example.test' },
  { id: 'sam', full_name: 'Sam Shah', email: 'sam@example.test' },
]

describe('PatientExternalAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.save.mockResolvedValue({ success: true })
  })
  afterEach(cleanup)

  it('starts with zero selected accounts and preserves picks across searches by name and email', async () => {
    render(<PatientExternalAccess patientId="patient-1" profiles={profiles} grantedProfileIds={[]} />)
    expect((screen.getByRole('checkbox', { name: /Alex Rao/ }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('checkbox', { name: /Sam Shah/ }) as HTMLInputElement).checked).toBe(false)

    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'Rao' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Alex Rao/ }))
    expect(screen.queryByRole('checkbox', { name: /Sam Shah/ })).toBeNull()
    fireEvent.change(search, { target: { value: 'sam@example' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Sam Shah/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }))

    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('patient-1', ['alex', 'sam']))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))
  })

  it('revokes the last grant and preserves selections when saving fails', async () => {
    mocks.save.mockResolvedValueOnce({ success: false, message: 'Unable to save patient access.' })
    render(<PatientExternalAccess patientId="patient-1" profiles={profiles} grantedProfileIds={['sam']} />)
    const checkbox = screen.getByRole('checkbox', { name: /Sam Shah/ }) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Unable to save patient access.'))
    expect(checkbox.checked).toBe(false)
    expect(mocks.refresh).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }))
    await waitFor(() => expect(mocks.save).toHaveBeenLastCalledWith('patient-1', []))
  })
  // Since mobile-number sign-in an External Staff login may have no email (incident 2026-11-24).
  it('lists and searches an account that has no email', () => {
    const withMobileOnly = [...profiles, { id: 'mobile', full_name: 'Mobile Only', email: null }]
    render(<PatientExternalAccess patientId="patient-1" profiles={withMobileOnly} grantedProfileIds={[]} />)
    expect(screen.getByRole('checkbox', { name: /Mobile Only/ })).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sam@example' } })
    expect(screen.queryByRole('checkbox', { name: /Mobile Only/ })).toBeNull()
    expect(screen.getByRole('checkbox', { name: /Sam Shah/ })).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'mobile' } })
    expect(screen.getByRole('checkbox', { name: /Mobile Only/ })).toBeTruthy()
  })
})
