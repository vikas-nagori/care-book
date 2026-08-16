import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdminUser: vi.fn(),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
  loggerError: vi.fn(),
  inviteUserByEmail: vi.fn(),
  profileUpsert: vi.fn(),
  inviteInsert: vi.fn(),
  requestRow: vi.fn(),
}))

// `@/lib/onboarding/invite-server` is left unmocked so this test covers the real
// syncInvitedProfile rather than a stub of it. Its `import 'server-only'` resolves through the
// alias in vitest.config.ts.
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('@/lib/platform/server', () => ({
  requirePlatformAdminUser: mocks.requirePlatformAdminUser,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() } }))

import { approveClinicOnboardingRequest } from './actions'

const CLINIC_ID = 'clinic-1'
const OWNER_AUTH_ID = 'owner-auth-1'

function adminClient() {
  const tables: Record<string, unknown> = {
    clinic_onboarding_requests: {
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: mocks.requestRow }) }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({ data: { id: 'request-1', status: 'approved' }, error: null }),
          }),
        }),
      }),
    },
    clinics: {
      insert: () => ({
        select: () => ({ single: async () => ({ data: { id: CLINIC_ID }, error: null }) }),
      }),
    },
    global_settings: { insert: async () => ({ error: null }) },
    profiles: { upsert: mocks.profileUpsert },
    user_invites: { insert: mocks.inviteInsert },
  }

  mocks.createAdminClient.mockReturnValue({
    from: vi.fn((table: string) => tables[table]),
    auth: { admin: { inviteUserByEmail: mocks.inviteUserByEmail } },
  })
}

describe('approveClinicOnboardingRequest', () => {
  beforeEach(() => {
    mocks.requirePlatformAdminUser.mockResolvedValue({ id: 'platform-admin', email: 'p@example.com' })
    mocks.requestRow.mockResolvedValue({
      data: {
        id: 'request-1',
        clinic_name: 'New Clinic',
        clinic_phone: null,
        clinic_address: null,
        owner_email: 'Owner@Example.com',
        owner_full_name: 'Owner Name',
        owner_mobile_number: '9999999999',
      },
      error: null,
    })
    mocks.inviteUserByEmail.mockResolvedValue({
      data: { user: { id: OWNER_AUTH_ID } },
      error: null,
    })
    mocks.profileUpsert.mockResolvedValue({ error: null })
    mocks.inviteInsert.mockResolvedValue({ error: null })
    adminClient()
  })

  it('promotes the trigger-created placeholder profile to admin of the new clinic', async () => {
    const result = await approveClinicOnboardingRequest({ requestId: 'request-1' })

    expect(result.success).toBe(true)
    expect(mocks.profileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: OWNER_AUTH_ID,
        clinic_id: CLINIC_ID,
        email: 'owner@example.com',
        role: 'admin',
      }),
      { onConflict: 'id' }
    )
  })

  it('does not overwrite the name captured on the invite record', async () => {
    await approveClinicOnboardingRequest({ requestId: 'request-1' })

    const [payload] = mocks.profileUpsert.mock.calls[0] as [Record<string, unknown>]
    expect(payload).not.toHaveProperty('full_name')
    expect(payload).not.toHaveProperty('mobile_number')
  })

  it('writes the profile only after the auth identity exists', async () => {
    await approveClinicOnboardingRequest({ requestId: 'request-1' })

    expect(mocks.inviteUserByEmail.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.profileUpsert.mock.invocationCallOrder[0]
    )
  })

  it('fails closed when the profile cannot be promoted, rather than reporting success', async () => {
    mocks.profileUpsert.mockResolvedValue({ error: { code: '23503', message: 'fk violation' } })

    const result = await approveClinicOnboardingRequest({ requestId: 'request-1' })

    expect(result).toEqual(
      expect.objectContaining({ success: false, errorCode: '23503' })
    )
    expect(mocks.inviteInsert).not.toHaveBeenCalled()
  })
})
