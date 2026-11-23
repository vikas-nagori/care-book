import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  createAdminClient: vi.fn(),
  updateUserById: vi.fn(),
  inviteRow: vi.fn(),
  profileUpsert: vi.fn(),
  inviteUpdate: vi.fn(),
  inviteUpdatePayload: vi.fn(),
  externalStaffUpdatePayload: vi.fn(),
  externalStaffUpdateFilters: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser, updateUser: mocks.updateUser },
  })),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, warn: mocks.loggerWarn, info: vi.fn() },
}))

import { completeForcedPasswordChange } from './actions'

const USER_ID = 'owner-auth-1'
const INVITE = {
  id: 'invite-1',
  clinic_id: 'clinic-1',
  email: 'owner@example.com',
  role: 'admin',
  full_name: 'Owner Name',
  mobile_number: '9999999999',
  status: 'pending',
  auth_user_id: USER_ID,
}

function flaggedUser(mustChange = true) {
  return {
    data: {
      user: {
        id: USER_ID,
        email: 'Owner@Example.com',
        app_metadata: { must_change_password: mustChange },
      },
    },
    error: null,
  }
}

function adminClient() {
  // .or(auth_user_id | email).eq('status','pending').order().limit().maybeSingle()
  const inviteEq2 = vi.fn(() => ({ order: () => ({ limit: () => ({ maybeSingle: mocks.inviteRow }) }) }))
  const inviteEq1 = vi.fn(() => ({ eq: inviteEq2 }))
  const inviteUpdateEq2 = vi.fn(async () => mocks.inviteUpdate())
  const inviteUpdateEq1 = vi.fn(() => ({ eq: inviteUpdateEq2 }))
  const tables: Record<string, unknown> = {
    user_invites: {
      select: () => ({ or: inviteEq1 }),
      update: (payload: unknown) => {
        mocks.inviteUpdatePayload(payload)
        return { eq: inviteUpdateEq1 }
      },
    },
    profiles: { upsert: mocks.profileUpsert },
    external_staff: {
      update: (payload: unknown) => {
        mocks.externalStaffUpdatePayload(payload)
        return {
          eq: (column1: string, value1: unknown) => ({
            eq: async (column2: string, value2: unknown) => {
              mocks.externalStaffUpdateFilters({ [column1]: value1, [column2]: value2 })
              return { error: null }
            },
          }),
        }
      },
    },
  }
  mocks.createAdminClient.mockReturnValue({
    from: vi.fn((table: string) => tables[table]),
    auth: { admin: { updateUserById: mocks.updateUserById } },
  })
}

const VALID_INPUT = { password: 'NewPassw0rd', passwordConfirmation: 'NewPassw0rd' }

describe('completeForcedPasswordChange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue(flaggedUser())
    mocks.updateUser.mockResolvedValue({ error: null })
    mocks.updateUserById.mockResolvedValue({ error: null })
    mocks.inviteRow.mockResolvedValue({ data: INVITE, error: null })
    mocks.profileUpsert.mockResolvedValue({ error: null })
    mocks.inviteUpdate.mockResolvedValue({ error: null })
    adminClient()
  })

  it('refuses without a session', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })

    const result = await completeForcedPasswordChange(VALID_INPUT)

    expect(result).toEqual(
      expect.objectContaining({ success: false, errorCode: 'PASSWORD_CHANGE_AUTH_REQUIRED' })
    )
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('refuses when the account is not flagged, so it can never be used as a free password change', async () => {
    mocks.getUser.mockResolvedValue(flaggedUser(false))

    const result = await completeForcedPasswordChange(VALID_INPUT)

    expect(result).toEqual(
      expect.objectContaining({ success: false, errorCode: 'PASSWORD_CHANGE_NOT_REQUIRED' })
    )
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('enforces the password policy before touching auth', async () => {
    const result = await completeForcedPasswordChange({
      password: 'weak',
      passwordConfirmation: 'weak',
    })

    expect(result).toEqual(
      expect.objectContaining({ success: false, errorCode: 'INVITE_PASSWORD_TOO_WEAK' })
    )
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('links the external staff record an invite was created from', async () => {
    mocks.inviteRow.mockResolvedValue({ data: { ...INVITE, external_staff_id: 'ext-1' }, error: null })

    const result = await completeForcedPasswordChange(VALID_INPUT)

    expect(result).toEqual({ success: true })
    expect(mocks.externalStaffUpdatePayload).toHaveBeenCalledWith({
      status: 'onboarded',
      linked_profile_id: USER_ID,
      email: 'owner@example.com',
    })
    expect(mocks.externalStaffUpdateFilters).toHaveBeenCalledWith({ id: 'ext-1', clinic_id: 'clinic-1' })
  })

  it('leaves external staff records alone for an ordinary invite', async () => {
    await completeForcedPasswordChange(VALID_INPUT)

    expect(mocks.externalStaffUpdatePayload).not.toHaveBeenCalled()
  })

  it('sets the password, clears the flag, and accepts the pending invite with name sync', async () => {
    const result = await completeForcedPasswordChange(VALID_INPUT)

    expect(result).toEqual({ success: true })
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'NewPassw0rd' })
    expect(mocks.updateUserById).toHaveBeenCalledWith(USER_ID, {
      app_metadata: { must_change_password: false },
    })
    expect(mocks.profileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: USER_ID,
        clinic_id: 'clinic-1',
        role: 'admin',
        full_name: 'Owner Name',
        mobile_number: '9999999999',
      }),
      { onConflict: 'id' }
    )
    expect(mocks.inviteUpdatePayload).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'accepted', auth_user_id: USER_ID })
    )
  })

  it('fails when the flag cannot be cleared, so the user is told to retry', async () => {
    mocks.updateUserById.mockResolvedValue({ error: { message: 'auth unavailable' } })

    const result = await completeForcedPasswordChange(VALID_INPUT)

    expect(result).toEqual(
      expect.objectContaining({ success: false, errorCode: 'PASSWORD_CHANGE_FLAG_CLEAR_FAILED' })
    )
  })

  it('treats invite sync problems as non-fatal once the password is changed', async () => {
    mocks.inviteRow.mockResolvedValue({ data: null, error: { message: 'lookup down' } })

    const result = await completeForcedPasswordChange(VALID_INPUT)

    expect(result).toEqual({ success: true })
    expect(mocks.loggerWarn).toHaveBeenCalled()
  })

  it('skips invite sync for an invite that belongs to a different auth user', async () => {
    mocks.inviteRow.mockResolvedValue({
      data: { ...INVITE, auth_user_id: 'someone-else' },
      error: null,
    })

    const result = await completeForcedPasswordChange(VALID_INPUT)

    expect(result).toEqual({ success: true })
    expect(mocks.profileUpsert).not.toHaveBeenCalled()
  })
})
