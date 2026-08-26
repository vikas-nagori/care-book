import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  createSupabaseClient: vi.fn(),
  signInWithPassword: vi.fn(),
  throwawaySignOut: vi.fn(),
  updateUser: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentProfile: mocks.getCurrentProfile }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createSupabaseClient }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { updateUser: mocks.updateUser } })),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() },
}))

import { changeOwnPassword } from './actions'

const VALID_INPUT = {
  currentPassword: 'OldPassw0rd',
  password: 'NewPassw0rd',
  passwordConfirmation: 'NewPassw0rd',
}

describe('changeOwnPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    mocks.getCurrentProfile.mockResolvedValue({
      id: 'staff-1',
      email: 'staff@example.com',
      role: 'staff',
      clinic_id: 'clinic-1',
    })
    mocks.signInWithPassword.mockResolvedValue({ error: null })
    mocks.throwawaySignOut.mockResolvedValue({ error: null })
    mocks.updateUser.mockResolvedValue({ error: null })
    mocks.createSupabaseClient.mockReturnValue({
      auth: { signInWithPassword: mocks.signInWithPassword, signOut: mocks.throwawaySignOut },
    })
  })

  it('refuses without a signed-in profile', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null)

    const result = await changeOwnPassword(VALID_INPUT)

    expect(result).toEqual(
      expect.objectContaining({ success: false, errorCode: 'PASSWORD_CHANGE_AUTH_REQUIRED' })
    )
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('is available to staff — verifies the current password and updates on the session', async () => {
    const result = await changeOwnPassword(VALID_INPUT)

    expect(result).toEqual({ success: true })
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'staff@example.com',
      password: 'OldPassw0rd',
    })
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'NewPassw0rd' })
  })

  it('requires the current password', async () => {
    const result = await changeOwnPassword({ ...VALID_INPUT, currentPassword: '' })

    expect(result).toEqual(
      expect.objectContaining({ success: false, errorCode: 'PASSWORD_CURRENT_REQUIRED' })
    )
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('rejects a wrong current password without changing anything', async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })

    const result = await changeOwnPassword(VALID_INPUT)

    expect(result).toEqual(
      expect.objectContaining({ success: false, errorCode: 'PASSWORD_CURRENT_INVALID' })
    )
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('enforces the password policy on the new password', async () => {
    const result = await changeOwnPassword({
      ...VALID_INPUT,
      password: 'weak',
      passwordConfirmation: 'weak',
    })

    expect(result).toEqual(
      expect.objectContaining({ success: false, errorCode: 'INVITE_PASSWORD_TOO_WEAK' })
    )
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
  })

  it('rejects a mismatched confirmation', async () => {
    const result = await changeOwnPassword({
      ...VALID_INPUT,
      passwordConfirmation: 'Different1',
    })

    expect(result).toEqual(
      expect.objectContaining({ success: false, errorCode: 'INVITE_PASSWORD_MISMATCH' })
    )
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
})
