// First-login forced password change. The flag lives in auth `app_metadata`, which only the
// service-role admin API can write — a user cannot clear it themselves (auth.updateUser touches
// user_metadata only). Middleware reads it off the verified getUser() result, so the gate costs
// no extra queries. This module must stay edge-safe (no Node imports): middleware runs it.

export const MUST_CHANGE_PASSWORD_FLAG = 'must_change_password'
export const FORCED_PASSWORD_CHANGE_PATH = '/auth/change-password'

export function mustChangePassword(
  appMetadata: Record<string, unknown> | null | undefined
): boolean {
  return appMetadata?.[MUST_CHANGE_PASSWORD_FLAG] === true
}

/**
 * True when a signed-in user must be redirected to the forced password-change page. `/auth/*`
 * is exempt so the change page itself, the callback, and complete-invite stay reachable.
 */
export function needsForcedPasswordChange(
  appMetadata: Record<string, unknown> | null | undefined,
  path: string
): boolean {
  return mustChangePassword(appMetadata) && !path.startsWith('/auth/')
}
