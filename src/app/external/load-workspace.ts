import 'server-only'

import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { evaluateRoleAccess } from '@/lib/auth-access'
import { EXTERNAL_ACCESS_MESSAGE, projectExternalWorkspace } from '@/lib/external/workspace'
import type { ExternalWorkspace } from '@/lib/external/types'
import { logger } from '@/lib/logger'
import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/lib/supabase/types'

/** Every /external page: internal users go home; a blocked/unavailable account gets a notice. */
export async function requireExternalProfile(): Promise<{ profile: Profile | null; authorized: boolean }> {
  const profile = await getCurrentProfile()
  if (profile && profile.role !== 'external_staff') redirect('/')
  return { profile, authorized: Boolean(profile) && evaluateRoleAccess(profile, ['external_staff']) === 'authorized' }
}

export async function loadExternalWorkspace(
  startDate: string,
  endDate: string,
): Promise<{ workspace: ExternalWorkspace; error?: undefined } | { workspace?: undefined; error: string }> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('external_workspace', {
      p_start_date: startDate,
      p_end_date: endDate,
    })
    if (error?.code === '42501') return { error: EXTERNAL_ACCESS_MESSAGE }
    if (!error) {
      const workspace = projectExternalWorkspace(data)
      if (workspace) return { workspace }
    }
    logger.warn('external/loadWorkspace', 'Workspace RPC failed.', { code: error?.code })
  } catch {
    logger.warn('external/loadWorkspace', 'Unable to load workspace.')
  }
  return { error: 'Unable to load your workspace. Try refreshing the page.' }
}
