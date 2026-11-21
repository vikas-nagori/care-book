import { loadActiveExternalProfiles } from '@/lib/appointments/external-profile-options'
import type { ExternalProfileOption } from '@/lib/appointments/assignment'
import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'

/**
 * External Staff the admin can assign for one patient: active accounts with a grant for it.
 * Read straight from the browser under RLS (only clinic admins can read grants), which avoids a
 * server-action round trip — and the per-client action queue — on every patient pick.
 */
export async function getExternalAssigneeOptions(patientId: string): Promise<
  { ok: true; profiles: ExternalProfileOption[] } | { ok: false }
> {
  try {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(patientId)) return { ok: false }
    return { ok: true, profiles: await loadActiveExternalProfiles(createClient(), null, patientId) }
  } catch {
    logger.warn('schedule/getExternalAssigneeOptions', 'Unable to load External Staff for the patient.')
    return { ok: false }
  }
}
