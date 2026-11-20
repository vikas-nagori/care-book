'use server'

import { getCurrentProfile } from '@/lib/auth'
import { evaluateRoleAccess } from '@/lib/auth-access'
import { loadActiveExternalProfiles } from '@/lib/appointments/external-profile-options'
import type { ExternalProfileOption } from '@/lib/appointments/assignment'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

export async function getExternalAssigneeOptions(patientId: string): Promise<
  { ok: true; profiles: ExternalProfileOption[] } | { ok: false }
> {
  try {
    const profile = await getCurrentProfile()
    if (!profile?.clinic_id || evaluateRoleAccess(profile, ['admin']) !== 'authorized') return { ok: false }
    if (typeof patientId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(patientId)) return { ok: false }

    const supabase = await createClient()
    return { ok: true, profiles: await loadActiveExternalProfiles(supabase, profile.clinic_id, patientId) }
  } catch (error) {
    logger.error('schedule/getExternalAssigneeOptions', error)
    return { ok: false }
  }
}
