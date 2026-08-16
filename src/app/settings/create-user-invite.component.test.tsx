import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
  loggerError: vi.fn(),
  inviteUserByEmail: vi.fn(),
  profileUpsert: vi.fn(),
  inviteInsert: vi.fn(),
  inviteInsertPayload: vi.fn(),
  existingInvite: vi.fn(),
  existingProfile: vi.fn(),
}))

// `@/lib/onboarding/invite-server` stays unmocked so the real syncInvitedProfile runs.
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentProfile: mocks.getCurrentProfile }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() } }))

import { createUserInvite } from './actions'

const CLINIC_ID = 'clinic-1'
const NEW_AUTH_ID = 'invited-auth-1'

function adminClient() {
  const tables: Record<string, unknown> = {
    user_invites: {
      select: () => ({
        eq: () => ({
          order: () => ({ limit: () => ({ maybeSingle: mocks.existingInvite }) }),
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
    profiles: {
      select: () => ({ eq: () => ({ maybeSingle: mocks.existingProfile }) }),
      upsert: mocks.profileUpsert,
    },
  }

  mocks.createAdminClient.mockReturnValue({
    from: vi.fn((table: string) => tables[table]),
    auth: { admin: { inviteUserByEmail: mocks.inviteUserByEmail } },
  })
}

function invite(role: 'admin' | 'staff') {
  return createUserInvite({
    email: 'New.User@Example.com',
    fullName: 'New User',
    mobileNumber: '9999999999',
    role,
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
    mocks.inviteUserByEmail.mockResolvedValue({ data: { user: { id: NEW_AUTH_ID } }, error: null })
    mocks.profileUpsert.mockResolvedValue({ error: null })
    mocks.inviteInsert.mockResolvedValue({ data: { id: 'invite-1' }, error: null })
    adminClient()
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
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled()
  })

  it('fails closed when the profile cannot be written', async () => {
    mocks.profileUpsert.mockResolvedValue({ error: { code: '23503', message: 'fk violation' } })

    const result = await invite('staff')

    expect(result).toEqual(expect.objectContaining({ success: false, errorCode: '23503' }))
  })
})
