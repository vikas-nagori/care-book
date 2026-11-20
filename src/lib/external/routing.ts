import type { UserRole } from '../supabase/types'

export const EXTERNAL_WORKSPACE_PATH = '/external'

const EXTERNAL_AUTH_PATHS = new Set([
  '/auth/callback',
  '/auth/change-password',
  '/auth/complete-invite',
  '/auth/update-password',
])

export function isExternalAuthPath(path: string): boolean {
  return EXTERNAL_AUTH_PATHS.has(path)
}

/** Sanitized, rate-limited client error/booking reports; the only API External Staff may call. */
const EXTERNAL_TELEMETRY_PATH = '/api/telemetry'

/**
 * The role the middleware routes by. A profile that reads back empty is a blocked account or
 * inactive clinic, which gets the closed workspace routes. A lookup that *errored* says nothing
 * about the account, so it is 'unavailable' rather than silently demoting an internal user.
 */
export function resolveMiddlewareRole(input: {
  role: UserRole | null
  lookupFailed: boolean
  isSuperadmin: boolean
  path: string
}): UserRole | null | 'unavailable' {
  if (input.isSuperadmin || isExternalAuthPath(input.path)) return input.role
  if (input.lookupFailed) return 'unavailable'
  return input.role ?? 'external_staff'
}

export function resolveExternalStaffRoute(
  role: UserRole | null,
  path: string,
  method: string,
): typeof EXTERNAL_WORKSPACE_PATH | 'forbidden' | null {
  if (role !== 'external_staff' || path === EXTERNAL_WORKSPACE_PATH || isExternalAuthPath(path)) return null
  if (path === EXTERNAL_TELEMETRY_PATH && method === 'POST') return null
  if ((method !== 'GET' && method !== 'HEAD') || path.startsWith('/api/')) return 'forbidden'
  return EXTERNAL_WORKSPACE_PATH
}
