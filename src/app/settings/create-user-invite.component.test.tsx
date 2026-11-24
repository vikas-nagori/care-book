import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
  loggerError: vi.fn(),
  inviteUserByEmail: vi.fn(),
  createUser: vi.fn(),
  updateUserById: vi.fn(),
  profileUpsert: vi.fn(),
  inviteInsert: vi.fn(),
  inviteInsertPayload: vi.fn(),
  existingInvite: vi.fn(),
  existingProfile: vi.fn(),
  profileById: vi.fn(),
  getUserById: vi.fn(),
  externalStaffUpdate: vi.fn(),
}))

// `@/lib/onboarding/invite-server` stays unmocked so the real syncInvitedProfile runs.
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentProfile: mocks.getCurrentProfile }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() } }))

import { createUserInvite } from './actions'
import { MOBILE_NUMBER_INVALID_MESSAGE, TEMPORARY_STAFF_PHONE_NOT_MOBILE_MESSAGE } from '@/lib/auth/mobile-number'

const CLINIC_ID = 'clinic-1'
const NEW_AUTH_ID = 'invited-auth-1'

// The lookups by mobile number (or email) return lists; the single-row mocks stand for "the match".
const asList = async (single: () => Promise<{ data: unknown; error: unknown }>) => {
  const { data, error } = await single()
  return { data: data ? [data] : [], error }
}

function adminClient() {
  const tables: Record<string, unknown> = {
    user_invites: {
      select: () => ({
        or: () => ({
          order: () => ({ limit: () => asList(mocks.existingInvite) }),
        }),
      }),
      insert: (payload: unknown) => {
        mocks.inviteInsertPayload(payload)
        return { select: () => ({ single: mocks.inviteInsert }) }
      },
      // Reusing a revoked invite updates the existing row instead of inserting a new one.
      update: (payload: unknown) => {
        mocks.inviteInsertPayload(payload)
        return {
          eq: () => ({ eq: () => ({ eq: () => ({ select: () => ({ single: mocks.inviteInsert }) }) }) }),
        }
      },
    },
    external_staff: {
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'temporary-1' }, error: null }) }) }),
      }),
      update: (payload: unknown) => {
        mocks.externalStaffUpdate(payload)
        return { eq: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }) }
      },
    },
    profiles: {
      select: () => ({
        or: () => ({ limit: () => asList(mocks.existingProfile) }),
        // verifyInviteeAccountForClinic reads the reused account's profile by id.
        eq: () => ({ maybeSingle: mocks.profileById }),
      }),
      upsert: mocks.profileUpsert,
    },
  }

  mocks.createAdminClient.mockReturnValue({
    from: vi.fn((table: string) => tables[table]),
    auth: {
      admin: {
        inviteUserByEmail: mocks.inviteUserByEmail,
        createUser: mocks.createUser,
        updateUserById: mocks.updateUserById,
        getUserById: mocks.getUserById,
      },
    },
  })
}

function invite(role: 'admin' | 'staff' | 'external_staff', externalStaffId?: string) {
  return createUserInvite({
    email: 'New.User@Example.com',
    fullName: 'New User',
    mobileNumber: '9999999999',
    role,
    externalStaffId,
  })
}

describe('createUserInvite', () => {
  beforeEach(() => {
    mocks.getCurrentProfile.mockResolvedValue({
      id: 'admin-1',
      role: 'admin',
      clinic_id: CLINIC_ID,
    })
    mocks.existingInvite.mockResolvedValue({ data: null, error: null })
    mocks.existingProfile.mockResolvedValue({ data: null, error: null })
    mocks.createUser.mockResolvedValue({ data: { user: { id: NEW_AUTH_ID } }, error: null })
    mocks.updateUserById.mockResolvedValue({ data: { user: { id: NEW_AUTH_ID } }, error: null })
    mocks.profileUpsert.mockResolvedValue({ error: null })
    mocks.profileById.mockResolvedValue({ data: { id: NEW_AUTH_ID, clinic_id: null }, error: null })
    mocks.getUserById.mockResolvedValue({ data: { user: { id: NEW_AUTH_ID, email: 'new.user@example.com' } }, error: null })
    mocks.inviteInsert.mockResolvedValue({ data: { id: 'invite-1' }, error: null })
    adminClient()
  })

  it('creates a confirmed mobile-number login with a temp password instead of sending an invite email', async () => {
    const result = await invite('staff')

    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled()
    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '9999999999',
        phone_confirm: true,
        email: 'new.user@example.com',
        email_confirm: true,
        app_metadata: { must_change_password: true },
      })
    )
    const { password } = mocks.createUser.mock.calls[0][0]
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        credentials: { mobileNumber: '9999999999', email: 'new.user@example.com', tempPassword: password },
      })
    )
    expect(password).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{14}$/)
    expect(mocks.inviteInsertPayload).toHaveBeenCalledWith(
      expect.objectContaining({ auth_user_id: NEW_AUTH_ID, status: 'pending' })
    )
  })

  it('never logs the temporary password', async () => {
    mocks.inviteInsert.mockResolvedValue({ data: null, error: { code: 'x', message: 'boom' } })

    await invite('staff')

    const { password } = mocks.createUser.mock.calls[0][0]
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(password)
  })

  it('attaches an invited staff member to the inviting admin clinic', async () => {
    const result = await invite('staff')

    expect(result.success).toBe(true)
    expect(mocks.profileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: NEW_AUTH_ID,
        clinic_id: CLINIC_ID,
        email: 'new.user@example.com',
        role: 'staff',
      }),
      { onConflict: 'id' }
    )
  })

  it('grants an invited admin the admin role rather than the placeholder staff default', async () => {
    const result = await invite('admin')

    expect(result.success).toBe(true)
    expect(mocks.profileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ clinic_id: CLINIC_ID, role: 'admin' }),
      { onConflict: 'id' }
    )
  })

  it('persists the restricted role on both a new External Staff profile and its invite', async () => {
    expect((await invite('external_staff')).success).toBe(true)
    expect(mocks.profileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ clinic_id: CLINIC_ID, role: 'external_staff' }),
      { onConflict: 'id' }
    )
    expect(mocks.inviteInsertPayload).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'external_staff', external_staff_id: null })
    )
  })

  it('rejects combining an External Staff invite with a Temporary Staff record', async () => {
    expect(await invite('external_staff', 'temporary-1')).toEqual(
      expect.objectContaining({ success: false, errorCode: 'INVITE_INVALID_INPUT' })
    )
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled()
  })

  it('G-8: takes the 10 digits out of a +91-formatted Temporary Staff phone for the login', async () => {
    const result = await createUserInvite({
      email: 'temp@example.com', fullName: 'Temp Staff', mobileNumber: '+91 98765 43210', role: 'staff', externalStaffId: 'temporary-1',
    })

    expect(result.success).toBe(true)
    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({ phone: '9876543210' }))
    expect(mocks.inviteInsertPayload).toHaveBeenCalledWith(
      expect.objectContaining({ mobile_number: '9876543210', external_staff_id: 'temporary-1' })
    )
    expect(mocks.externalStaffUpdate).toHaveBeenCalledWith({ email: 'temp@example.com', phone: '9876543210' })
  })

  it('G-8: says plainly when a Temporary Staff phone holds no mobile number', async () => {
    const result = await createUserInvite({
      email: 'temp@example.com', fullName: 'Temp Staff', mobileNumber: '022 2345 6789', role: 'staff', externalStaffId: 'temporary-1',
    })

    expect(result).toEqual(expect.objectContaining({ success: false, message: TEMPORARY_STAFF_PHONE_NOT_MOBILE_MESSAGE }))
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it('still validates what an admin types into Invite User strictly', async () => {
    const result = await createUserInvite({
      email: 'new@example.com', fullName: 'New User', mobileNumber: '+91 98765 43210', role: 'staff',
    })

    expect(result).toEqual(expect.objectContaining({ success: false, message: MOBILE_NUMBER_INVALID_MESSAGE }))
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it('records the captured name and mobile on the invite so acceptance can use them', async () => {
    await invite('staff')

    expect(mocks.inviteInsertPayload).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: 'New User', mobile_number: '9999999999' })
    )
  })

  it('re-invites an email whose earlier invite was revoked, despite its placeholder profile', async () => {
    mocks.existingInvite.mockResolvedValue({
      data: { id: 'old-invite', clinic_id: CLINIC_ID, status: 'revoked', auth_user_id: NEW_AUTH_ID },
      error: null,
    })
    mocks.existingProfile.mockResolvedValue({
      data: { id: NEW_AUTH_ID, email: 'new.user@example.com', status: 'active' },
      error: null,
    })

    const result = await invite('staff')

    expect(result.success).toBe(true)
    // The auth identity already exists, so it is re-armed rather than created again — and the
    // ban placed on revocation is lifted.
    expect(mocks.createUser).not.toHaveBeenCalled()
    expect(mocks.updateUserById).toHaveBeenCalledWith(
      NEW_AUTH_ID,
      expect.objectContaining({
        phone: '9999999999',
        phone_confirm: true,
        email_confirm: true,
        ban_duration: 'none',
        app_metadata: { must_change_password: true },
      })
    )
  })

  it("refuses to re-arm a revoked invite's account that now belongs to another clinic", async () => {
    mocks.existingInvite.mockResolvedValue({
      data: { id: 'old-invite', clinic_id: CLINIC_ID, status: 'revoked', auth_user_id: 'victim-1' },
      error: null,
    })
    mocks.profileById.mockResolvedValue({ data: { id: 'victim-1', clinic_id: 'clinic-2' }, error: null })
    mocks.getUserById.mockResolvedValue({ data: { user: { id: 'victim-1', email: 'victim@example.com' } }, error: null })

    const result = await invite('staff')

    expect(result).toEqual(expect.objectContaining({ success: false, errorCode: 'INVITE_EMAIL_UNAVAILABLE' }))
    expect(mocks.updateUserById).not.toHaveBeenCalled()
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it('creates a mobile-only login when no email is given', async () => {
    const result = await createUserInvite({ fullName: 'No Email', mobileNumber: '95112 19264', role: 'staff' })

    expect(result.success).toBe(true)
    const args = mocks.createUser.mock.calls[0][0]
    expect(args).toEqual(expect.objectContaining({ phone: '9511219264', phone_confirm: true }))
    expect(args).not.toHaveProperty('email')
    expect(mocks.inviteInsertPayload).toHaveBeenCalledWith(
      expect.objectContaining({ email: null, mobile_number: '9511219264' })
    )
  })

  it('rejects a mobile number that cannot be a login', async () => {
    const result = await createUserInvite({ fullName: 'Bad', mobileNumber: '12345', role: 'staff' })

    expect(result).toEqual(expect.objectContaining({ success: false, errorCode: 'INVITE_INVALID_INPUT' }))
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it('reports a failure to create the login without saving an invite', async () => {
    mocks.createUser.mockResolvedValue({
      data: { user: null },
      error: { code: 'email_exists', message: 'already registered' },
    })

    const result = await invite('staff')

    expect(result).toEqual(expect.objectContaining({ success: false, errorCode: 'email_exists' }))
    expect(mocks.inviteInsertPayload).not.toHaveBeenCalled()
  })

  it('still refuses an email that already belongs to an accepted user', async () => {
    mocks.existingInvite.mockResolvedValue({
      data: { id: 'old-invite', clinic_id: CLINIC_ID, status: 'accepted', auth_user_id: NEW_AUTH_ID },
      error: null,
    })
    mocks.existingProfile.mockResolvedValue({
      data: { id: NEW_AUTH_ID, email: 'new.user@example.com', status: 'active' },
      error: null,
    })

    const result = await invite('staff')

    expect(result).toEqual(
      expect.objectContaining({ success: false, errorCode: 'INVITE_USER_ALREADY_ACTIVE' })
    )
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it('fails closed when the profile cannot be written', async () => {
    mocks.profileUpsert.mockResolvedValue({ error: { code: '23503', message: 'fk violation' } })

    const result = await invite('staff')

    expect(result).toEqual(expect.objectContaining({ success: false, errorCode: '23503' }))
  })
})
