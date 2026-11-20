import 'server-only'

import type { createAdminClient } from '@/lib/supabase/admin'
import type { UserRole } from '@/lib/supabase/types'
import { BAN_DURATION, UNBAN_DURATION } from '@/lib/platform/block'
import { MUST_CHANGE_PASSWORD_FLAG } from '@/lib/security/forced-password-change'
import {
  DEFAULT_INVITE_NEXT_PATH,
  normalizeSiteOrigin,
} from './invite-helpers'
import { generateTempPassword } from './temp-password'

const DEFAULT_APP_ORIGIN = 'http://localhost:3000'

export function getAppOrigin() {
  return normalizeSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL) ?? DEFAULT_APP_ORIGIN
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

export type InviteeAccountResult =
  | { authUserId: string; tempPassword: string; error: null }
  | { authUserId: null; tempPassword: null; error: { code?: string; message: string } }

/**
 * Give an invitee a usable login without sending email: a confirmed auth account holding a
 * one-time temporary password, with `must_change_password` armed so middleware forces them onto
 * /auth/change-password at first sign-in. The caller shows the password to the inviting admin
 * once; it is never persisted or logged.
 *
 * `existingAuthUserId` is set when re-inviting an email whose auth identity already exists (a
 * revoked invite, or a legacy email invite): `createUser` would fail on the taken email, so the
 * existing account is re-armed instead — new password, flag set, and the revocation ban lifted.
 */
export async function provisionInviteeAccount(
  adminSupabase: ReturnType<typeof createAdminClient>,
  input: { email: string; existingAuthUserId: string | null }
): Promise<InviteeAccountResult> {
  const tempPassword = generateTempPassword()

  if (input.existingAuthUserId) {
    const { error } = await adminSupabase.auth.admin.updateUserById(input.existingAuthUserId, {
      password: tempPassword,
      // Legacy email invites leave the account unconfirmed until the link is clicked, and GoTrue
      // refuses password sign-in for unconfirmed emails. The admin handing the password over
      // directly is the address verification here.
      email_confirm: true,
      ban_duration: UNBAN_DURATION,
      app_metadata: { [MUST_CHANGE_PASSWORD_FLAG]: true },
    })
    if (error) return { authUserId: null, tempPassword: null, error }
    return { authUserId: input.existingAuthUserId, tempPassword, error: null }
  }

  const { data, error } = await adminSupabase.auth.admin.createUser({
    email: input.email,
    password: tempPassword,
    email_confirm: true,
    app_metadata: { [MUST_CHANGE_PASSWORD_FLAG]: true },
  })
  if (error || !data.user?.id) {
    return {
      authUserId: null,
      tempPassword: null,
      error: error ?? { message: 'Account creation returned no user.' },
    }
  }
  return { authUserId: data.user.id, tempPassword, error: null }
}

/**
 * Close a revoked invitee's account: ban sign-in, and reset the profile to the clinic-less
 * placeholder the auth trigger writes. The reset is what cuts data access immediately — RLS keys
 * every tenant read off `profiles.clinic_id` — while the ban stops a held access token from being
 * refreshed and the temp password from being used again.
 */
export async function closeRevokedInviteeAccount(
  adminSupabase: ReturnType<typeof createAdminClient>,
  authUserId: string
) {
  const { error: profileError } = await adminSupabase
    .from('profiles')
    .update({ clinic_id: null, role: 'staff', updated_at: new Date().toISOString() })
    .eq('id', authUserId)
  if (profileError) return { error: profileError }

  const { error: banError } = await adminSupabase.auth.admin.updateUserById(authUserId, {
    ban_duration: BAN_DURATION,
  })
  return { error: banError }
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
