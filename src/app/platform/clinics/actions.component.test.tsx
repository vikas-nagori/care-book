import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdminUser: vi.fn(),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
  loggerError: vi.fn(),
  updateUserById: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/platform/server', () => ({ requirePlatformAdminUser: mocks.requirePlatformAdminUser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError } }))

import { blockClinic } from './actions'

function adminClient(members: { id: string; status: string }[]) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'clinic-1' }, error: null })
  const update = vi.fn(() => ({ eq: () => ({ select: () => ({ maybeSingle }) }) }))
  const select = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: members, error: null }) }))
  mocks.createAdminClient.mockReturnValue({
    from: vi.fn(() => ({ update, select })),
    auth: { admin: { updateUserById: mocks.updateUserById } },
  })
}

// G-9: a failed ban used to be logged and swallowed, so the console said "Clinic blocked" while
// some of its users were still signed in.
describe('blockClinic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePlatformAdminUser.mockResolvedValue({ id: 'platform-admin', email: 'platform@example.com' })
    adminClient([{ id: 'user-1', status: 'active' }, { id: 'user-2', status: 'active' }])
  })

  it('reports a block once every member is banned', async () => {
    mocks.updateUserById.mockResolvedValue({ error: null })

    const result = await blockClinic({ clinicId: 'clinic-1' })

    expect(result).toEqual({ success: true, status: 'inactive' })
    expect(mocks.updateUserById).toHaveBeenCalledTimes(2)
  })

  it('does not report a block as done when a member could not be banned', async () => {
    mocks.updateUserById
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'auth unavailable' } })

    const result = await blockClinic({ clinicId: 'clinic-1' })

    expect(result).toEqual(expect.objectContaining({ success: false, errorCode: 'CLINIC_BAN_FAILED' }))
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
