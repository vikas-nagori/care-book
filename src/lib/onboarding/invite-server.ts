import 'server-only'

import type { createAdminClient } from '@/lib/supabase/admin'
import type { UserRole } from '@/lib/supabase/types'
import { BAN_DURATION, UNBAN_DURATION } from '@/lib/platform/block'
import { MUST_CHANGE_PASSWORD_FLAG } from '@/lib/security/forced-password-change'
import { isPlatformAdminEmail } from '@/lib/platform/access'
import { toAuthPhone } from '@/lib/auth/mobile-number'
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
  email: string | null
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
 * The login is the mobile number (`auth.users.phone`, confirmed here because the admin handing
 * the password over in person is the verification); email is attached only when one was given.
 *
 * `existingAuthUserId` is set when re-inviting someone whose auth identity already exists (a
 * revoked invite, or a legacy email invite): `createUser` would fail on the taken number or email,
 * so the existing account is re-armed instead — new password, flag set, and the revocation ban
 * lifted. Callers must pass it through `verifyInviteeAccountForClinic` first.
 */
export async function provisionInviteeAccount(
  adminSupabase: ReturnType<typeof createAdminClient>,
  input: { email: string | null; mobileNumber: string; existingAuthUserId: string | null }
): Promise<InviteeAccountResult> {
  const tempPassword = generateTempPassword()
  const phone = toAuthPhone(input.mobileNumber)

  if (input.existingAuthUserId) {
    const { error } = await adminSupabase.auth.admin.updateUserById(input.existingAuthUserId, {
      password: tempPassword,
      phone,
      phone_confirm: true,
      // Legacy email invites leave the account unconfirmed until the link is clicked, and GoTrue
      // refuses password sign-in for unconfirmed emails. The admin handing the password over
      // directly is the address verification here.
      ...(input.email ? { email_confirm: true } : {}),
      ban_duration: UNBAN_DURATION,
      app_metadata: { [MUST_CHANGE_PASSWORD_FLAG]: true },
    })
    if (error) return { authUserId: null, tempPassword: null, error }
    return { authUserId: input.existingAuthUserId, tempPassword, error: null }
  }

  const { data, error } = await adminSupabase.auth.admin.createUser({
    phone,
    phone_confirm: true,
    ...(input.email ? { email: input.email, email_confirm: true } : {}),
    password: tempPassword,
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

export type InviteeAccountCheck =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'other_clinic' | 'platform_admin' | 'lookup_failed' }

/**
 * Whether a clinic admin's invite action may reset the password of, or ban, this auth account.
 *
 * Only an account that is this clinic's own, or the clinic-less placeholder a revoke leaves
 * behind, qualifies — never an account attached to another clinic, and never a platform admin.
 * Without this, any identifier that reached the reset/ban calls (an invite row's auth_user_id,
 * a profile matched by email) let one clinic take over or lock out another clinic's users
 * (security review 2026-11-21).
 */
export async function verifyInviteeAccountForClinic(
  adminSupabase: ReturnType<typeof createAdminClient>,
  authUserId: string,
  clinicId: string
): Promise<InviteeAccountCheck> {
  const [{ data: profile, error: profileError }, { data: authData, error: authError }] = await Promise.all([
    adminSupabase.from('profiles').select('id, clinic_id').eq('id', authUserId).maybeSingle(),
    adminSupabase.auth.admin.getUserById(authUserId),
  ])
  if (profileError || authError) return { ok: false, reason: 'lookup_failed' }
  if (!profile || !authData?.user) return { ok: false, reason: 'not_found' }
  if (isPlatformAdminEmail(authData.user.email)) return { ok: false, reason: 'platform_admin' }
  if (profile.clinic_id !== null && profile.clinic_id !== clinicId) return { ok: false, reason: 'other_clinic' }
  return { ok: true }
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
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : null
  if (code === 'phone_exists') return 'This mobile number already belongs to another account.'
  if (code === 'email_exists') return 'This email address already belongs to another account.'

  if (error instanceof Error) {
    if (error.message.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      return 'Add SUPABASE_SERVICE_ROLE_KEY to enable invite management.'
    }

    return 'Unable to manage invites right now.'
  }

  return 'Unable to manage invites right now.'
}
