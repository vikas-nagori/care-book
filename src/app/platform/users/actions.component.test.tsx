import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdminUser: vi.fn(),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
  loggerError: vi.fn(),
  maybeSingle: vi.fn(),
  update: vi.fn(),
  updateUserById: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/platform/server', () => ({
  requirePlatformAdminUser: mocks.requirePlatformAdminUser,
}))
vi.mock('@/lib/platform/access', () => ({
  isPlatformAdminEmail: (email: string) => email === 'platform@example.com',
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/onboarding/invite-server', () => ({ getAppOrigin: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError } }))

import { softDeleteUser, unblockUser } from './actions'

function adminClient() {
  const neq = vi.fn().mockResolvedValue({ error: null })
  const eqAfterUpdate = vi.fn(() => ({ neq }))
  mocks.update.mockReturnValue({ eq: eqAfterUpdate })
  const eqAfterSelect = vi.fn(() => ({ maybeSingle: mocks.maybeSingle }))
  const select = vi.fn(() => ({ eq: eqAfterSelect }))
  const from = vi.fn(() => ({ select, update: mocks.update }))
  const client = {
    from,
    auth: { admin: { updateUserById: mocks.updateUserById } },
  }
  mocks.createAdminClient.mockReturnValue(client)
  return { neq }
}

describe('softDeleteUser', () => {
  beforeEach(() => {
    mocks.requirePlatformAdminUser.mockResolvedValue({ id: 'platform-admin', email: 'platform@example.com' })
    mocks.updateUserById.mockResolvedValue({ error: null })
    adminClient()
  })

  it('requires a reason before loading or changing the user', async () => {
    const result = await softDeleteUser({ userId: 'user-1', reason: '   ' })

    expect(result).toEqual(expect.objectContaining({ success: false, errorCode: 'DELETION_REASON_REQUIRED' }))
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('bans the auth identity and records normalized immutable deletion metadata', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: 'user-1', email: 'user@example.com', status: 'active' },
      error: null,
    })

    const result = await softDeleteUser({ userId: 'user-1', reason: '  left clinic  ' })

    expect(result).toEqual({ success: true, status: 'deleted' })
    expect(mocks.updateUserById).toHaveBeenCalledWith('user-1', { ban_duration: '876000h' })
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'deleted',
      deleted_by: 'platform-admin',
      deletion_reason: 'left clinic',
    }))
    expect(mocks.updateUserById.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[0])
  })

  it('is idempotent for an already deleted profile without rewriting its audit fields', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: 'user-1', email: 'user@example.com', status: 'deleted' },
      error: null,
    })

    const result = await softDeleteUser({ userId: 'user-1', reason: 'different retry reason' })

    expect(result).toEqual({ success: true, status: 'deleted' })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.updateUserById).toHaveBeenCalledWith('user-1', { ban_duration: '876000h' })
  })

  it('fails closed without changing the profile when the Auth ban fails', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: 'user-1', email: 'user@example.com', status: 'active' },
      error: null,
    })
    mocks.updateUserById.mockResolvedValue({ error: { message: 'auth unavailable' } })

    const result = await softDeleteUser({ userId: 'user-1', reason: 'left clinic' })

    expect(result).toEqual(expect.objectContaining({ success: false, errorCode: 'USER_BAN_FAILED' }))
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('cannot be bypassed through the ordinary unblock action', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: 'user-1', status: 'deleted', clinic_id: 'clinic-1', clinic: { status: 'active' } },
      error: null,
    })

    const result = await unblockUser({ userId: 'user-1' })

    expect(result).toEqual(expect.objectContaining({ success: false, errorCode: 'USER_DELETED' }))
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })
})
