import type { UserRole } from './supabase/types'

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  staff: 'Staff',
  external_staff: 'External Staff',
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && Object.hasOwn(USER_ROLE_LABELS, value)
}
