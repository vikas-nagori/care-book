import type { Profile } from '../supabase/types.ts'
import { isActiveMcpProfile } from './access.ts'
import { createUserScopedClientForGrant } from './identity.ts'
import type { ResolvedGrant, ToolContext } from './registry.ts'

export async function buildToolContext(grant: ResolvedGrant): Promise<ToolContext | null> {
  const supabase = await createUserScopedClientForGrant(grant)
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', grant.userId).maybeSingle()
  if (error || !profile || profile.clinic_id !== grant.clinicId || !isActiveMcpProfile(profile)) return null
  return { supabase, profile: profile as Profile, grant }
}
