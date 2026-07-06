import type { ClinicStatus, Profile, UserRole } from '@/lib/supabase/types'

export type RoleAccessResult =
  | 'authorized'
  | 'missing_profile'
  | 'blocked_profile'
  | 'inactive_clinic'
  | 'insufficient_role'

export type ProfileAccessShape = Pick<Profile, 'role' | 'clinic_id' | 'status'> & {
  clinic?: { status: ClinicStatus | null } | { status: ClinicStatus | null }[] | null
}

function getClinicStatus(profile: ProfileAccessShape): ClinicStatus | null {
  const clinic = Array.isArray(profile.clinic) ? profile.clinic[0] : profile.clinic
  return clinic?.status ?? null
}

export function evaluateRoleAccess(
  profile: ProfileAccessShape | null,
  allowedRoles: UserRole[]
): RoleAccessResult {
  if (!profile) return 'missing_profile'
  if (!profile.clinic_id) return 'missing_profile'
  if (profile.status === 'blocked') return 'blocked_profile'
  if (getClinicStatus(profile) === 'inactive') return 'inactive_clinic'
  if (!allowedRoles.includes(profile.role)) return 'insufficient_role'
  return 'authorized'
}
