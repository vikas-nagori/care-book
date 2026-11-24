import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { UserInvite } from '@/lib/supabase/types'

const mocks = vi.hoisted(() => ({
  createUserInvite: vi.fn(),
  issueInviteTempPassword: vi.fn(),
  revokeUserInvite: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('next/navigation', async (importOriginal) => ({
  // Keep the real unstable_* helpers: callServerAction uses them to classify a rejected action.
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: mocks.refresh }),
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('./actions', () => ({
  createUserInvite: mocks.createUserInvite,
  issueInviteTempPassword: mocks.issueInviteTempPassword,
  revokeUserInvite: mocks.revokeUserInvite,
}))

import { InviteForm } from './invite-form'
import { UserInvitesList } from './user-invites-list'

const PENDING_INVITE = {
  id: 'invite-1',
  clinic_id: 'clinic-1',
  email: 'asha@example.com',
  role: 'staff',
  status: 'pending',
  auth_user_id: 'auth-1',
  external_staff_id: null,
  full_name: 'Asha Patel',
  mobile_number: '9876543210',
  invited_by: 'admin-1',
  accepted_at: null,
  revoked_at: null,
  created_at: '2026-11-21T00:00:00.000Z',
  updated_at: '2026-11-21T00:00:00.000Z',
} as UserInvite

const CREDENTIALS = { mobileNumber: '9876543210', email: 'asha@example.com', tempPassword: 'Abcdef23456789' }

describe('invite UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the temporary password once the login is created, instead of promising an email', async () => {
    mocks.createUserInvite.mockResolvedValue({ success: true, invite: PENDING_INVITE, credentials: CREDENTIALS })
    render(<InviteForm />)

    fireEvent.change(screen.getByLabelText('Invitee name'), { target: { value: 'Asha Patel' } })
    fireEvent.change(screen.getByLabelText(/^Mobile number/), { target: { value: '9876543210' } })
    fireEvent.change(screen.getByLabelText('Invite email'), { target: { value: 'asha@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Login' }))

    await waitFor(() => {
      expect(screen.getByTestId('temp-password').textContent).toBe(CREDENTIALS.tempPassword)
    })
    expect(mocks.createUserInvite).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'asha@example.com', role: 'staff' })
    )
    expect(screen.queryByText(/email link/i)).toBeNull()
    // The mobile number is the login the admin hands over.
    expect(screen.getByTestId('temp-login-mobile').textContent).toBe('98765 43210')
  })

  it('creates a login without an email', async () => {
    mocks.createUserInvite.mockResolvedValue({
      success: true,
      invite: { ...PENDING_INVITE, email: null },
      credentials: { ...CREDENTIALS, email: null },
    })
    render(<InviteForm />)

    fireEvent.change(screen.getByLabelText('Invitee name'), { target: { value: 'Asha Patel' } })
    fireEvent.change(screen.getByLabelText(/^Mobile number/), { target: { value: '9876543210' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Login' }))

    await waitFor(() => {
      expect(screen.getByTestId('temp-password').textContent).toBe(CREDENTIALS.tempPassword)
    })
    expect(mocks.createUserInvite).toHaveBeenCalledWith(expect.objectContaining({ mobileNumber: '9876543210', email: null }))
  })

  // Prod 2026-11-24: the action call rejected (no response from the server) and the button sat on
  // "Creating login…" forever, with no message and nothing logged.
  it('recovers when the invite request fails instead of spinning forever', async () => {
    mocks.createUserInvite.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<InviteForm />)

    fireEvent.change(screen.getByLabelText('Invitee name'), { target: { value: 'Dr Asha' } })
    fireEvent.change(screen.getByLabelText(/^Mobile number/), { target: { value: '9876543210' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Login' }))

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Login not created',
        description: "Couldn't get a response from Care-Book. Check your connection, then refresh to see whether it went through before trying again.",
        variant: 'destructive',
      }))
    })
    expect((screen.getByRole('button', { name: 'Create Login' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('reloads onto the new version when the app is older than the server', async () => {
    const { UnrecognizedActionError } = await import('next/dist/client/components/unrecognized-action-error')
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mocks.createUserInvite.mockRejectedValue(new UnrecognizedActionError('Server Action "x" was not found on the server.'))
      render(<InviteForm />)
      fireEvent.change(screen.getByLabelText('Invitee name'), { target: { value: 'Dr Asha' } })
      fireEvent.change(screen.getByLabelText(/^Mobile number/), { target: { value: '9876543210' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create Login' }))

      await waitFor(() => {
        expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
          description: 'Care-Book was just updated. Reloading to get the latest version…',
        }))
      })
      expect(reload).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1_600)
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  // Prod feedback 2026-11-24: invites listed only the number, so admins couldn't tell who an
  // invite was for. The name leads; the login (number or email) sits underneath.
  it.each(['card', 'sheet'] as const)('names who each invite is for (%s layout)', (variant) => {
    const mobileOnly = { ...PENDING_INVITE, id: 'invite-2', email: null, full_name: 'Dr Test Invitee', mobile_number: '9988776655' }
    const nameless = { ...PENDING_INVITE, id: 'invite-3', email: null, full_name: null, mobile_number: '9123456780' }
    render(<UserInvitesList invites={[mobileOnly, nameless]} variant={variant} />)

    expect(screen.getByText('Dr Test Invitee')).toBeTruthy()
    expect(screen.getByText('99887 76655')).toBeTruthy()
    // A legacy invite without a name still says who it is for.
    expect(screen.getByText('91234 56780')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Revoke invite to 99887 76655' })).toHaveLength(1)
  })

  it('issues and shows a new temporary password for a pending invite', async () => {
    mocks.issueInviteTempPassword.mockResolvedValue({
      success: true,
      invite: PENDING_INVITE,
      credentials: CREDENTIALS,
    })
    render(<UserInvitesList invites={[PENDING_INVITE]} />)

    fireEvent.click(screen.getByRole('button', { name: 'New temporary password for asha@example.com' }))

    await waitFor(() => {
      expect(screen.getByTestId('temp-password').textContent).toBe(CREDENTIALS.tempPassword)
    })
    expect(mocks.issueInviteTempPassword).toHaveBeenCalledWith({ inviteId: 'invite-1' })
  })

  it('offers no password action once an invite is accepted', () => {
    render(
      <UserInvitesList
        invites={[{ ...PENDING_INVITE, status: 'accepted', accepted_at: '2026-11-21T01:00:00.000Z' }]}
      />
    )

    expect(screen.queryByRole('button', { name: /New temporary password/ })).toBeNull()
  })
})
