import { beforeEach, describe, expect, it, vi } from 'vitest'
import { meetsInvitePasswordPolicy } from '@/lib/onboarding/invite-helpers'

const mocks = vi.hoisted(() => ({
  requirePlatformAdminUser: vi.fn(),
  createAdminClient: vi.fn(),
  profileRow: vi.fn(),
  inviteByUser: vi.fn(),
  inviteByEmail: vi.fn(),
  updateUserById: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('@/lib/platform/server', () => ({
  requirePlatformAdminUser: mocks.requirePlatformAdminUser,
}))
vi.mock('@/lib/platform/access', () => ({ isPlatformAdminEmail: () => false }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/onboarding/invite-server', () => ({ getAppOrigin: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() },
}))

import { issueTempPassword } from './actions'

const USER_ID = 'owner-auth-1'

function adminClient() {
  const tables: Record<string, unknown> = {
    profiles: {
      select: () => ({ eq: () => ({ maybeSingle: mocks.profileRow }) }),
    },
    user_invites: {
      select: () => ({
        eq: (column: string) => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: column === 'auth_user_id' ? mocks.inviteByUser : mocks.inviteByEmail,
              }),
            }),
          }),
        }),
      }),
    },
  }
  mocks.createAdminClient.mockReturnValue({
    from: vi.fn((table: string) => tables[table]),
    auth: { admin: { updateUserById: mocks.updateUserById } },
  })
}

describe('issueTempPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePlatformAdminUser.mockResolvedValue({ id: 'platform-admin', email: 'p@example.com' })
    mocks.profileRow.mockResolvedValue({
      data: { id: USER_ID, email: 'Owner@Example.com', status: 'active' },
      error: null,
    })
    mocks.inviteByUser.mockResolvedValue({ data: { id: 'invite-1' }, error: null })
    mocks.inviteByEmail.mockResolvedValue({ data: null, error: null })
    mocks.updateUserById.mockResolvedValue({ error: null })
    adminClient()
  })

  it('issues a policy-passing temp password and re-arms the forced-change flag', async () => {
    const result = await issueTempPassword({ userId: USER_ID })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(mocks.updateUserById).toHaveBeenCalledTimes(1)
    const [id, payload] = mocks.updateUserById.mock.calls[0] as [
      string,
      { password: string; email_confirm: boolean; app_metadata: Record<string, unknown> },
    ]
    expect(id).toBe(USER_ID)
    expect(meetsInvitePasswordPolicy(payload.password)).toBe(true)
    expect(payload.app_metadata).toEqual({ must_change_password: true })
    // Legacy invite-email accounts are unconfirmed until their link is clicked; without this,
    // sign-in with the issued password fails with "Email not confirmed".
    expect(payload.email_confirm).toBe(true)
    expect(result.credentials).toEqual({
      email: 'Owner@Example.com',
      tempPassword: payload.password,
    })
  })

  it('falls back to matching the pending invite by email', async () => {
    mocks.inviteByUser.mockResolvedValue({ data: null, error: null })
    mocks.inviteByEmail.mockResolvedValue({ data: { id: 'invite-1' }, error: null })

    const result = await issueTempPassword({ userId: USER_ID })

    expect(result.success).toBe(true)
  })

  it('refuses once the user has set their own password (no pending invite)', async () => {
    mocks.inviteByUser.mockResolvedValue({ data: null, error: null })
    mocks.inviteByEmail.mockResolvedValue({ data: null, error: null })

    const result = await issueTempPassword({ userId: USER_ID })

    expect(result).toEqual(
      expect.objectContaining({ success: false, errorCode: 'TEMP_PASSWORD_NOT_ELIGIBLE' })
    )
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })

  it('refuses deleted users', async () => {
    mocks.profileRow.mockResolvedValue({
      data: { id: USER_ID, email: 'Owner@Example.com', status: 'deleted' },
      error: null,
    })

    const result = await issueTempPassword({ userId: USER_ID })

    expect(result).toEqual(expect.objectContaining({ success: false, errorCode: 'USER_DELETED' }))
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })
})
