import 'server-only'

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type { ExternalProfileOption } from './assignment'

const PAGE_SIZE = 500

export async function readExternalAccessRows<Row>(
  getPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: PostgrestError | null }>,
): Promise<Row[]> {
  const rows: Row[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await getPage(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    if (!data?.length) return rows
    rows.push(...data)
    if (data.length < PAGE_SIZE) return rows
  }
}

export async function loadActiveExternalProfiles(
  supabase: SupabaseClient,
  clinicId: string,
  patientId?: string,
): Promise<ExternalProfileOption[]> {
  const profiles = patientId
    ? readExternalAccessRows((from, to) => supabase
        .from('patient_external_access')
        .select('profile:profiles!patient_external_access_external_profile_id_fkey!inner(id, full_name, email)')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .eq('profile.clinic_id', clinicId)
        .eq('profile.role', 'external_staff')
        .eq('profile.status', 'active')
        .order('external_profile_id')
        .range(from, to))
        .then((grants) => grants.flatMap(({ profile }) => Array.isArray(profile) ? profile : [profile]))
    : readExternalAccessRows((from, to) => supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('clinic_id', clinicId)
        .eq('role', 'external_staff')
        .eq('status', 'active')
        .order('id')
        .range(from, to))
  const [candidates, incompleteInvites] = await Promise.all([
    profiles,
    readExternalAccessRows((from, to) => supabase
      .from('user_invites')
      .select('auth_user_id, email')
      .eq('clinic_id', clinicId)
      .in('status', ['pending', 'revoked'])
      .order('id')
      .range(from, to)),
  ])

  const invitedIds = new Set(incompleteInvites.map((invite) => invite.auth_user_id))
  const invitedEmails = new Set(incompleteInvites.filter((invite) => !invite.auth_user_id).map((invite) => invite.email.toLowerCase()))
  return (candidates as ExternalProfileOption[])
    .filter((profile) => !invitedIds.has(profile.id) && !invitedEmails.has(profile.email.toLowerCase()))
    .sort((left, right) => (left.full_name || left.email).localeCompare(right.full_name || right.email))
}
