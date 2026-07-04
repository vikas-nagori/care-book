import type { Profile } from '../supabase/types'

export function getSettingsAccessLevel(profile: Profile | null) {
  if (!profile) return 'unauthenticated'
  if (profile.role === 'admin') return 'admin'
  return 'profile_only'
}
