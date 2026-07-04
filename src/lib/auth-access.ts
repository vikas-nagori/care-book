import type { Profile, UserRole } from '@/lib/supabase/types'

export type RoleAccessResult = 'authorized' | 'missing_profile' | 'insufficient_role'

export function evaluateRoleAccess(
  profile: Pick<Profile, 'role'> | null,
  allowedRoles: UserRole[]
): RoleAccessResult {
  if (!profile) return 'missing_profile'
  if (!allowedRoles.includes(profile.role)) return 'insufficient_role'
  return 'authorized'
}
