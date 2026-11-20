import type { Profile, UserRole } from '../supabase/types'

export function canUseMcpRole(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'staff'
}

export function isActiveMcpProfile(profile: Pick<Profile, 'role' | 'status' | 'clinic_id'> | null): boolean {
  return Boolean(profile?.clinic_id && profile.status === 'active' && canUseMcpRole(profile.role))
}
