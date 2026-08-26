'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminUser } from '@/lib/platform/server'
import { isPlatformAdminEmail } from '@/lib/platform/access'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getAppOrigin } from '@/lib/onboarding/invite-server'
import { normalizeEmail } from '@/lib/onboarding/invite-helpers'
import { generateTempPassword } from '@/lib/onboarding/temp-password'
import { MUST_CHANGE_PASSWORD_FLAG } from '@/lib/security/forced-password-change'
import { logger } from '@/lib/logger'
import { BAN_DURATION, UNBAN_DURATION, shouldUnbanOnUserUnblock } from '@/lib/platform/block'
import { normalizeUserDeletionReason } from '@/lib/platform/user-lifecycle'
import type {
  ClinicStatus,
  IssueTempPasswordInput,
  IssueTempPasswordResult,
  ManageUserBlockInput,
  ManageUserBlockResult,
  SoftDeleteUserInput,
} from '@/lib/supabase/types'

export type SendPasswordResetResult = { success: boolean; errorCode?: string; message?: string }

async function setBan(
  adminSupabase: ReturnType<typeof createAdminClient>,
  userId: string,
  banDuration: string
): Promise<boolean> {
  const { error } = await adminSupabase.auth.admin.updateUserById(userId, {
    ban_duration: banDuration,
  })
  if (error) {
    logger.error('platform/users/setBan', error, { userId, banDuration })
    return false
  }
  return true
}

export async function blockUser(input: ManageUserBlockInput): Promise<ManageUserBlockResult> {
  try {
    await requirePlatformAdminUser()
    if (!input.userId) {
      return { success: false, errorCode: 'USER_ID_REQUIRED', message: 'Choose a user.' }
    }

    const adminSupabase = createAdminClient()
    const { data: target, error: lookupError } = await adminSupabase
      .from('profiles')
      .select('id, email, status')
      .eq('id', input.userId)
      .maybeSingle()

    if (lookupError || !target) {
      logger.error('platform/blockUser/lookup', lookupError, input)
      return {
        success: false,
        errorCode: lookupError?.code ?? 'USER_NOT_FOUND',
        message: 'User was not found.',
      }
    }

    if (isPlatformAdminEmail(target.email)) {
      return {
        success: false,
        errorCode: 'CANNOT_BLOCK_SUPERADMIN',
        message: 'Superadmin accounts cannot be blocked.',
      }
    }

    if (target.status === 'deleted') {
      return {
        success: false,
        errorCode: 'USER_DELETED',
        message: 'Deleted users cannot be blocked or restored.',
      }
    }

    const { error } = await adminSupabase
      .from('profiles')
      .update({ status: 'blocked', updated_at: new Date().toISOString() })
      .eq('id', input.userId)

    if (error) {
      logger.error('platform/blockUser/update', error, input)
      return { success: false, errorCode: error.code ?? 'USER_BLOCK_FAILED', message: error.message }
    }

    await setBan(adminSupabase, input.userId, BAN_DURATION)

    revalidatePath('/platform/users')
    return { success: true, status: 'blocked' }
  } catch (error) {
    logger.error('platform/blockUser/unexpected', error, input)
    return { success: false, errorCode: 'USER_BLOCK_FAILED', message: 'Unable to block this user right now.' }
  }
}

export async function sendPasswordReset(input: ManageUserBlockInput): Promise<SendPasswordResetResult> {
  try {
    await requirePlatformAdminUser()
    if (!input.userId) {
      return { success: false, errorCode: 'USER_ID_REQUIRED', message: 'Choose a user.' }
    }

    const adminSupabase = createAdminClient()
    const { data: target, error: lookupError } = await adminSupabase
      .from('profiles')
      .select('id, email, status')
      .eq('id', input.userId)
      .maybeSingle()

    if (lookupError || !target?.email) {
      logger.error('platform/sendPasswordReset/lookup', lookupError, input)
      return {
        success: false,
        errorCode: lookupError?.code ?? 'USER_NOT_FOUND',
        message: 'User was not found.',
      }
    }

    if (target.status === 'deleted') {
      return {
        success: false,
        errorCode: 'USER_DELETED',
        message: 'Deleted users cannot receive password resets.',
      }
    }

    // Prefer the canonical site URL so the reset link never points at localhost; the recovery
    // email template routes through /auth/callback (token_hash) to the update-password page.
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (await getAppOrigin())
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent('/auth/update-password')}`

    const authClient = await createClient()
    const { error: resetError } = await authClient.auth.resetPasswordForEmail(target.email, { redirectTo })

    if (resetError) {
      logger.error('platform/sendPasswordReset/send', resetError, { userId: input.userId })
      return { success: false, errorCode: 'PASSWORD_RESET_FAILED', message: resetError.message }
    }

    return { success: true }
  } catch (error) {
    logger.error('platform/sendPasswordReset/unexpected', error, input)
    return { success: false, errorCode: 'PASSWORD_RESET_FAILED', message: 'Unable to send a reset link right now.' }
  }
}

export async function unblockUser(input: ManageUserBlockInput): Promise<ManageUserBlockResult> {
  try {
    await requirePlatformAdminUser()
    if (!input.userId) {
      return { success: false, errorCode: 'USER_ID_REQUIRED', message: 'Choose a user.' }
    }

    const adminSupabase = createAdminClient()
    const { data: target, error: lookupError } = await adminSupabase
      .from('profiles')
      .select('id, status, clinic_id, clinic:clinics(status)')
      .eq('id', input.userId)
      .maybeSingle()

    if (lookupError || !target) {
      logger.error('platform/unblockUser/lookup', lookupError, input)
      return {
        success: false,
        errorCode: lookupError?.code ?? 'USER_NOT_FOUND',
        message: 'User was not found.',
      }
    }

    if (target.status === 'deleted') {
      return {
        success: false,
        errorCode: 'USER_DELETED',
        message: 'Deleted users cannot be unblocked or restored.',
      }
    }

    const { error } = await adminSupabase
      .from('profiles')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', input.userId)

    if (error) {
      logger.error('platform/unblockUser/update', error, input)
      return { success: false, errorCode: error.code ?? 'USER_UNBLOCK_FAILED', message: error.message }
    }

    // Embedded one-to-one relation may come back as an object or a single-element array.
    const clinic = Array.isArray(target.clinic) ? target.clinic[0] : target.clinic
    const clinicStatus: ClinicStatus | null = clinic?.status ?? null

    if (shouldUnbanOnUserUnblock(clinicStatus)) {
      await setBan(adminSupabase, input.userId, UNBAN_DURATION)
    }

    revalidatePath('/platform/users')
    return { success: true, status: 'active' }
  } catch (error) {
    logger.error('platform/unblockUser/unexpected', error, input)
    return { success: false, errorCode: 'USER_UNBLOCK_FAILED', message: 'Unable to unblock this user right now.' }
  }
}

export async function softDeleteUser(input: SoftDeleteUserInput): Promise<ManageUserBlockResult> {
  try {
    const platformAdmin = await requirePlatformAdminUser()
    const reason = normalizeUserDeletionReason(input.reason)

    if (!input.userId) {
      return { success: false, errorCode: 'USER_ID_REQUIRED', message: 'Choose a user.' }
    }
    if (!reason) {
      return {
        success: false,
        errorCode: 'DELETION_REASON_REQUIRED',
        message: 'Enter a reason for deleting this user.',
      }
    }

    const adminSupabase = createAdminClient()
    const { data: target, error: lookupError } = await adminSupabase
      .from('profiles')
      .select('id, email, status')
      .eq('id', input.userId)
      .maybeSingle()

    if (lookupError || !target) {
      logger.error('platform/softDeleteUser/lookup', lookupError, { userId: input.userId })
      return {
        success: false,
        errorCode: lookupError?.code ?? 'USER_NOT_FOUND',
        message: 'User was not found.',
      }
    }

    if (isPlatformAdminEmail(target.email)) {
      return {
        success: false,
        errorCode: 'CANNOT_DELETE_SUPERADMIN',
        message: 'Superadmin accounts cannot be deleted.',
      }
    }

    const banSucceeded = await setBan(adminSupabase, input.userId, BAN_DURATION)
    if (!banSucceeded) {
      return {
        success: false,
        errorCode: 'USER_BAN_FAILED',
        message: 'The user could not be signed out, so deletion was not applied.',
      }
    }

    if (target.status !== 'deleted') {
      const deletedAt = new Date().toISOString()
      const { error: updateError } = await adminSupabase
        .from('profiles')
        .update({
          status: 'deleted',
          deleted_at: deletedAt,
          deleted_by: platformAdmin.id,
          deletion_reason: reason,
          updated_at: deletedAt,
        })
        .eq('id', input.userId)
        .neq('status', 'deleted')

      if (updateError) {
        logger.error('platform/softDeleteUser/update', updateError, { userId: input.userId })
        return {
          success: false,
          errorCode: updateError.code ?? 'USER_DELETE_FAILED',
          message: updateError.message,
        }
      }
    }

    revalidatePath('/platform/users')
    return { success: true, status: 'deleted' }
  } catch (error) {
    logger.error('platform/softDeleteUser/unexpected', error, { userId: input.userId })
    return {
      success: false,
      errorCode: 'USER_DELETE_FAILED',
      message: 'Unable to delete this user right now.',
    }
  }
}

export async function issueTempPassword(
  input: IssueTempPasswordInput
): Promise<IssueTempPasswordResult> {
  try {
    await requirePlatformAdminUser()
    if (!input.userId) {
      return { success: false, errorCode: 'USER_ID_REQUIRED', message: 'Choose a user.' }
    }

    const adminSupabase = createAdminClient()
    const { data: target, error: lookupError } = await adminSupabase
      .from('profiles')
      .select('id, email, status')
      .eq('id', input.userId)
      .maybeSingle()

    if (lookupError || !target?.email) {
      logger.error('platform/issueTempPassword/lookup', lookupError, { userId: input.userId })
      return {
        success: false,
        errorCode: lookupError?.code ?? 'USER_NOT_FOUND',
        message: 'User was not found.',
      }
    }

    if (target.status === 'deleted') {
      return {
        success: false,
        errorCode: 'USER_DELETED',
        message: 'Deleted users cannot receive temporary passwords.',
      }
    }

    // A temp password may only be issued while the user has never set their own password —
    // their invite is still pending. Once they complete first login, re-issuing would clobber
    // a real password, so it is refused.
    let { data: pendingInvite } = await adminSupabase
      .from('user_invites')
      .select('id')
      .eq('auth_user_id', input.userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!pendingInvite) {
      const { data: byEmail } = await adminSupabase
        .from('user_invites')
        .select('id')
        .eq('email', normalizeEmail(target.email))
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      pendingInvite = byEmail
    }

    if (!pendingInvite) {
      return {
        success: false,
        errorCode: 'TEMP_PASSWORD_NOT_ELIGIBLE',
        message:
          'This user has already set their own password. Ask them to change it themselves, or use a reset link.',
      }
    }

    const tempPassword = generateTempPassword()
    const { error: updateError } = await adminSupabase.auth.admin.updateUserById(input.userId, {
      password: tempPassword,
      app_metadata: { [MUST_CHANGE_PASSWORD_FLAG]: true },
    })

    if (updateError) {
      logger.error('platform/issueTempPassword/updateUser', updateError, { userId: input.userId })
      return {
        success: false,
        errorCode: 'TEMP_PASSWORD_ISSUE_FAILED',
        message: 'Unable to issue a temporary password right now.',
      }
    }

    return {
      success: true,
      credentials: { email: target.email, tempPassword },
    }
  } catch (error) {
    logger.error('platform/issueTempPassword/unexpected', error, { userId: input.userId })
    return {
      success: false,
      errorCode: 'TEMP_PASSWORD_ISSUE_FAILED',
      message: 'Unable to issue a temporary password right now.',
    }
  }
}
