import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { accountDisplayName } from '../auth/mobile-number.ts'
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

/**
 * External Staff an admin can share with or assign. Runs under the caller's RLS (admins only see
 * their clinic), so it works from the server or the browser. `clinicId` adds an explicit second
 * scope check where the caller knows it.
 */
export async function loadActiveExternalProfiles(
  supabase: SupabaseClient,
  clinicId: string | null,
  patientId?: string,
): Promise<ExternalProfileOption[]> {
  const profiles = patientId
    ? readExternalAccessRows((from, to) => {
        let query = supabase
          .from('patient_external_access')
          .select('profile:profiles!patient_external_access_external_profile_id_fkey!inner(id, full_name, email, mobile_number)')
          .eq('patient_id', patientId)
          .eq('profile.role', 'external_staff')
          .eq('profile.status', 'active')
        if (clinicId) query = query.eq('clinic_id', clinicId).eq('profile.clinic_id', clinicId)
        return query.order('external_profile_id').range(from, to)
      }).then((grants) => grants.flatMap(({ profile }) => Array.isArray(profile) ? profile : [profile]))
    : readExternalAccessRows((from, to) => {
        let query = supabase
          .from('profiles')
          .select('id, full_name, email, mobile_number')
          .eq('role', 'external_staff')
          .eq('status', 'active')
        if (clinicId) query = query.eq('clinic_id', clinicId)
        return query.order('id').range(from, to)
      })
  // Mirrors private.eligible_external_profile: invited accounts that have not signed in yet are
  // eligible (their temporary-password login already exists), so patients can be shared with
  // them before they first sign in; revoked ones are not.
  const [candidates, invites] = await Promise.all([
    profiles,
    readExternalAccessRows<{ auth_user_id: string | null; email: string | null; status: string; full_name: string | null }>((from, to) => {
      let query = supabase.from('user_invites').select('auth_user_id, email, status, full_name').in('status', ['pending', 'revoked'])
      if (clinicId) query = query.eq('clinic_id', clinicId)
      return query.order('id').range(from, to)
    }),
  ])

  const revokedInvites = invites.filter((invite) => invite.status === 'revoked')
  const revokedIds = new Set(revokedInvites.map((invite) => invite.auth_user_id))
  const revokedEmails = new Set(revokedInvites.filter((invite) => !invite.auth_user_id && invite.email).map((invite) => invite.email!.toLowerCase()))
  // A pending invitee's profile has no name yet (it is copied from the invite on acceptance).
  const pendingNames = new Map(invites
    .filter((invite) => invite.status === 'pending' && invite.auth_user_id)
    .map((invite) => [invite.auth_user_id!, invite.full_name]))
  return (candidates as ExternalProfileOption[])
    .filter((profile) => !revokedIds.has(profile.id) && !(profile.email && revokedEmails.has(profile.email.toLowerCase())))
    .map((profile) => ({
      ...profile,
      full_name: profile.full_name?.trim() || pendingNames.get(profile.id)?.trim() || null,
      mobile_number: profile.mobile_number ?? null,
      invite_pending: pendingNames.has(profile.id),
    }))
    .sort((left, right) => accountDisplayName(left).localeCompare(accountDisplayName(right)))
}
