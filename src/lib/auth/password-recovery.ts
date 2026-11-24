// Who may use /auth/update-password (decision D4d, change C-4).
//
// That page sets a new password with no current-password check, which is right for someone who
// proved they own the account by opening a reset link, and wrong for anyone else holding a
// signed-in phone. So /auth/callback marks the session a reset link created, and the page lets in
// only that session; any other signed-in user is sent to where they can change their password
// the normal way (with the current one).
//
// The mark is a short-lived httpOnly cookie holding the reset session's id (the `session_id`
// claim of its access token). It names one session, so it cannot be carried over to a later
// sign-in, and it never touches the Supabase session cookies: nothing here signs anyone out.

import type { UserRole } from '../supabase/types'

export const PASSWORD_RECOVERY_PATH = '/auth/update-password'
export const PASSWORD_RECOVERY_COOKIE = 'cb-password-recovery'
/** Long enough to read the email and pick a password; the link itself expires sooner. */
export const PASSWORD_RECOVERY_MAX_AGE_SECONDS = 60 * 60

/** True when /auth/callback is finishing a password-reset link rather than an invite. */
export function isPasswordRecoveryCallback(input: { type: string | null; nextPath: string }): boolean {
  return input.type === 'recovery' || input.nextPath === PASSWORD_RECOVERY_PATH
}

/** The `session_id` claim of a Supabase access token, or null if it has none. Not a verification. */
export function sessionIdFromAccessToken(accessToken: string | null | undefined): string | null {
  const payload = accessToken?.split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
    const claims: unknown = JSON.parse(atob(base64))
    const sessionId = claims && typeof claims === 'object' ? (claims as { session_id?: unknown }).session_id : null
    return typeof sessionId === 'string' && sessionId ? sessionId : null
  } catch {
    return null
  }
}

/** The cookie /auth/callback sets on its redirect once a reset link has signed the user in. */
export function passwordRecoveryCookie(sessionId: string, secure: boolean) {
  return {
    name: PASSWORD_RECOVERY_COOKIE,
    value: sessionId,
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: PASSWORD_RECOVERY_PATH,
    maxAge: PASSWORD_RECOVERY_MAX_AGE_SECONDS,
  }
}

/**
 * 'allow' for the session a reset link created; otherwise where a signed-in user who opened the
 * page directly belongs: the platform console, External Staff's own account page, or Settings.
 */
export function resolveUpdatePasswordAccess(input: {
  markedSessionId: string | null | undefined
  currentSessionId: string | null
  isPlatformAdmin: boolean
  role: UserRole | null
}): 'allow' | '/platform' | '/external/account' | '/settings' {
  if (input.markedSessionId && input.currentSessionId && input.markedSessionId === input.currentSessionId) {
    return 'allow'
  }
  if (input.isPlatformAdmin) return '/platform'
  if (input.role === 'external_staff') return '/external/account'
  return '/settings'
}
