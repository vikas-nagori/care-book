import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
  loggerError: vi.fn(),
  createUser: vi.fn(),
  updateUserById: vi.fn(),
  inviteLookup: vi.fn(),
  inviteUpdate: vi.fn(),
  inviteUpdatePayload: vi.fn(),
  profileUpdate: vi.fn(),
  profileUpdatePayload: vi.fn(),
  profileLookup: vi.fn(),
  profileUpsert: vi.fn(),
  getUserById: vi.fn(),
  calls: [] as string[],
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentProfile: mocks.getCurrentProfile }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() } }))

import { issueInviteTempPassword, revokeUserInvite } from './actions'

const CLINIC_ID = 'clinic-1'
const AUTH_ID = 'invitee-auth-1'
const PENDING_INVITE = {
  id: 'invite-1',
  clinic_id: CLINIC_ID,
  email: 'asha@example.com',
  mobile_number: '9876543210',
  role: 'staff',
  status: 'pending',
  auth_user_id: AUTH_ID,
}

// A chainable query stub: every filter returns itself, and the terminal call resolves `result`.
function chain(result: () => unknown) {
  const query: Record<string, unknown> = {}
  for (const method of ['eq', 'or', 'select', 'order', 'limit']) query[method] = () => query
  query.maybeSingle = result
  query.single = result
  return query
}

function adminClient() {
  const tables: Record<string, unknown> = {
    user_invites: {
      select: () => chain(mocks.inviteLookup),
      update: (payload: unknown) => {
        mocks.calls.push('invite-update')
        mocks.inviteUpdatePayload(payload)
        return chain(mocks.inviteUpdate)
      },
    },
    profiles: {
      select: () => chain(mocks.profileLookup),
      upsert: mocks.profileUpsert,
      update: (payload: unknown) => {
        mocks.calls.push('profile-reset')
        mocks.profileUpdatePayload(payload)
        return { eq: mocks.profileUpdate }
      },
    },
  }

  mocks.createAdminClient.mockReturnValue({
    from: vi.fn((table: string) => tables[table]),
    auth: {
      admin: { createUser: mocks.createUser, updateUserById: mocks.updateUserById, getUserById: mocks.getUserById },
    },
  })
}

describe('invite temp-password management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.calls.length = 0
    mocks.getCurrentProfile.mockResolvedValue({ id: 'admin-1', role: 'admin', clinic_id: CLINIC_ID })
    mocks.inviteLookup.mockResolvedValue({ data: PENDING_INVITE, error: null })
    mocks.inviteUpdate.mockResolvedValue({ data: { ...PENDING_INVITE }, error: null })
    mocks.profileUpdate.mockResolvedValue({ error: null })
    // The invitee's own profile, attached to this clinic (what verifyInviteeAccountForClinic reads).
    mocks.profileLookup.mockResolvedValue({ data: { id: AUTH_ID, clinic_id: CLINIC_ID }, error: null })
    mocks.getUserById.mockResolvedValue({ data: { user: { id: AUTH_ID, email: 'asha@example.com' } }, error: null })
    mocks.profileUpsert.mockResolvedValue({ error: null })
    mocks.createUser.mockResolvedValue({ data: { user: { id: AUTH_ID } }, error: null })
    mocks.updateUserById.mockImplementation(async (_id: string, attrs: Record<string, unknown>) => {
      mocks.calls.push(attrs.ban_duration === '876000h' ? 'ban' : 'reset-password')
      return { data: { user: { id: AUTH_ID } }, error: null }
    })
    adminClient()
  })

  describe('issueInviteTempPassword', () => {
    it('re-arms the pending invitee with a fresh temp password and returns it once', async () => {
      const result = await issueInviteTempPassword({ inviteId: 'invite-1' })

      expect(mocks.updateUserById).toHaveBeenCalledWith(
        AUTH_ID,
        expect.objectContaining({
          phone: '9876543210',
          phone_confirm: true,
          email_confirm: true,
          app_metadata: { must_change_password: true },
        })
      )
      const { password } = mocks.updateUserById.mock.calls[0][1]
      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          credentials: { mobileNumber: '9876543210', email: 'asha@example.com', tempPassword: password },
        })
      )
      expect(mocks.createUser).not.toHaveBeenCalled()
    })

    it('refuses an invite that is no longer pending, so a real password is never clobbered', async () => {
      mocks.inviteLookup.mockResolvedValue({
        data: { ...PENDING_INVITE, status: 'accepted' },
        error: null,
      })

      const result = await issueInviteTempPassword({ inviteId: 'invite-1' })

      expect(result).toEqual(expect.objectContaining({ success: false, errorCode: 'INVITE_NOT_PENDING' }))
      expect(mocks.updateUserById).not.toHaveBeenCalled()
    })

    it('creates the login for a legacy invite that never got an auth identity', async () => {
      mocks.inviteLookup.mockResolvedValue({ data: { ...PENDING_INVITE, auth_user_id: null }, error: null })
      mocks.profileLookup.mockResolvedValue({ data: null, error: null })

      const result = await issueInviteTempPassword({ inviteId: 'invite-1' })

      expect(result.success).toBe(true)
      expect(mocks.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '9876543210', email: 'asha@example.com', email_confirm: true })
      )
      expect(mocks.profileUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: AUTH_ID, clinic_id: CLINIC_ID, role: 'staff' }),
        { onConflict: 'id' }
      )
      expect(mocks.inviteUpdatePayload).toHaveBeenCalledWith(
        expect.objectContaining({ auth_user_id: AUTH_ID })
      )
    })

    it('never resets an account attached to another clinic, whatever the invite row says', async () => {
      mocks.profileLookup.mockResolvedValue({ data: { id: AUTH_ID, clinic_id: 'clinic-2' }, error: null })
      const result = await issueInviteTempPassword({ inviteId: 'invite-1' })
      expect(result).toEqual(expect.objectContaining({ success: false }))
      expect(mocks.updateUserById).not.toHaveBeenCalled()
    })

    it('never resets a platform admin', async () => {
      vi.stubEnv('PLATFORM_ADMIN_EMAILS', 'root@example.com')
      mocks.profileLookup.mockResolvedValue({ data: { id: AUTH_ID, clinic_id: null }, error: null })
      mocks.getUserById.mockResolvedValue({ data: { user: { id: AUTH_ID, email: 'root@example.com' } }, error: null })
      const result = await issueInviteTempPassword({ inviteId: 'invite-1' })
      expect(result).toEqual(expect.objectContaining({ success: false }))
      expect(mocks.updateUserById).not.toHaveBeenCalled()
    })

    it('is admin-only', async () => {
      mocks.getCurrentProfile.mockResolvedValue({ id: 'staff-1', role: 'staff', clinic_id: CLINIC_ID })

      const result = await issueInviteTempPassword({ inviteId: 'invite-1' })

      expect(result).toEqual(expect.objectContaining({ success: false, errorCode: 'INVITE_UNAUTHORIZED' }))
      expect(mocks.updateUserById).not.toHaveBeenCalled()
    })
  })

  describe('revokeUserInvite', () => {
    it('detaches the profile from the clinic and bans sign-in before marking the invite revoked', async () => {
      mocks.inviteUpdate.mockResolvedValue({ data: { ...PENDING_INVITE, status: 'revoked' }, error: null })

      const result = await revokeUserInvite({ inviteId: 'invite-1' })

      expect(result.success).toBe(true)
      expect(mocks.profileUpdatePayload).toHaveBeenCalledWith(
        expect.objectContaining({ clinic_id: null, role: 'staff' })
      )
      expect(mocks.profileUpdate).toHaveBeenCalledWith('id', AUTH_ID)
      expect(mocks.updateUserById).toHaveBeenCalledWith(AUTH_ID, { ban_duration: '876000h' })
      expect(mocks.calls).toEqual(['profile-reset', 'ban', 'invite-update'])
      expect(mocks.inviteUpdatePayload).toHaveBeenCalledWith(expect.objectContaining({ status: 'revoked' }))
    })

    it('leaves the invite pending when the account cannot be closed, so revoke can be retried', async () => {
      mocks.updateUserById.mockResolvedValue({ data: null, error: { code: 'unexpected', message: 'down' } })

      const result = await revokeUserInvite({ inviteId: 'invite-1' })

      expect(result).toEqual(expect.objectContaining({ success: false }))
      expect(mocks.inviteUpdatePayload).not.toHaveBeenCalled()
    })

    it('never bans an account attached to another clinic', async () => {
      mocks.profileLookup.mockResolvedValue({ data: { id: AUTH_ID, clinic_id: 'clinic-2' }, error: null })
      const result = await revokeUserInvite({ inviteId: 'invite-1' })
      expect(result).toEqual(expect.objectContaining({ success: false, errorCode: 'INVITE_REVOKE_FAILED' }))
      expect(mocks.profileUpdatePayload).not.toHaveBeenCalled()
      expect(mocks.updateUserById).not.toHaveBeenCalled()
    })

    it('refuses a non-pending invite without touching any account', async () => {
      mocks.inviteLookup.mockResolvedValue({ data: null, error: null })

      const result = await revokeUserInvite({ inviteId: 'invite-1' })

      expect(result).toEqual(expect.objectContaining({ success: false, errorCode: 'INVITE_NOT_PENDING' }))
      expect(mocks.profileUpdatePayload).not.toHaveBeenCalled()
      expect(mocks.updateUserById).not.toHaveBeenCalled()
    })
  })
})
