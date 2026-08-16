import 'server-only'

import type { createAdminClient } from '@/lib/supabase/admin'
import type { UserRole } from '@/lib/supabase/types'
import {
  buildInviteRedirectUrl,
  DEFAULT_INVITE_NEXT_PATH,
  normalizeSiteOrigin,
} from './invite-helpers'

const DEFAULT_APP_ORIGIN = 'http://localhost:3000'

export function getAppOrigin() {
  return normalizeSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL) ?? DEFAULT_APP_ORIGIN
}

export function buildInviteRedirectTo() {
  return buildInviteRedirectUrl(getAppOrigin())
}

export function sanitizeNextPath(nextPath: string | null | undefined) {
  if (!nextPath || !nextPath.startsWith('/') || nextPath.startsWith('//')) {
    return DEFAULT_INVITE_NEXT_PATH
  }

  return nextPath
}

export type InvitedProfileSync = {
  authUserId: string
  clinicId: string
  email: string
  role: UserRole
}

/**
 * Write an invited user's real role and clinic onto their profile row.
 *
 * `auth.admin.inviteUserByEmail` creates the `auth.users` row, which fires the
 * `on_auth_user_created` trigger. That trigger deliberately ignores the invite metadata —
 * `raw_user_meta_data` is caller-controlled on self-signup, so trusting it would let anyone
 * mint an admin of any clinic — and inserts an unprivileged placeholder instead
 * (role 'staff', no clinic). Without this call the placeholder is what the platform console
 * shows until the invite is accepted, and a user who sets a password through a reset link
 * rather than the invite link signs in as a clinic-less staff member.
 *
 * `completeInvitedSignup` upserts the same values again on acceptance, so this is a
 * make-it-true-now step, not the only writer. It writes role and clinic only — name and
 * mobile stay with the acceptance path, which sources them from the invite record.
 */
export async function syncInvitedProfile(
  adminSupabase: ReturnType<typeof createAdminClient>,
  invited: InvitedProfileSync
) {
  const { error } = await adminSupabase.from('profiles').upsert(
    {
      id: invited.authUserId,
      clinic_id: invited.clinicId,
      email: invited.email,
      role: invited.role,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  )

  return { error }
}

export function getInviteErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      return 'Add SUPABASE_SERVICE_ROLE_KEY to enable invite management.'
    }

    return 'Unable to manage invites right now.'
  }

  return 'Unable to manage invites right now.'
}
