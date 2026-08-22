import type { Profile } from '../supabase/types.ts'
import { createUserScopedClientForGrant } from './identity.ts'
import type { ResolvedGrant, ToolContext } from './registry.ts'

export async function buildToolContext(grant: ResolvedGrant): Promise<ToolContext | null> {
  const supabase = await createUserScopedClientForGrant(grant)
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', grant.userId).maybeSingle()
  if (error || !profile) return null
  return { supabase, profile: profile as Profile, grant }
}
