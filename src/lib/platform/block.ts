import type { ClinicStatus, ProfileStatus } from '@/lib/supabase/types'

// Supabase Auth ban durations. A blocked user/clinic is banned for ~100 years;
// unblocking clears the ban with 'none'.
export const BAN_DURATION = '876000h'
export const UNBAN_DURATION = 'none'

// When a clinic is unblocked, each of its users should be un-banned — EXCEPT
// users who were individually blocked (profiles.status = 'blocked'), who must
// stay banned.
export function shouldUnbanOnClinicUnblock(profileStatus: ProfileStatus): boolean {
  return profileStatus === 'active'
}

// When a user is unblocked, they should only be un-banned if their clinic is
// active — never reactivate a user into a blocked (inactive) clinic.
export function shouldUnbanOnUserUnblock(clinicStatus: ClinicStatus | null): boolean {
  return clinicStatus === 'active'
}
