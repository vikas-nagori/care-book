'use server'

import { logger } from '@/lib/logger'
import { validateInviteCompletionInput, normalizeEmail } from '@/lib/onboarding/invite-helpers'
import { getInviteErrorMessage } from '@/lib/onboarding/invite-server'
import { MUST_CHANGE_PASSWORD_FLAG, mustChangePassword } from '@/lib/security/forced-password-change'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type {
  ForcedPasswordChangeInput,
  ForcedPasswordChangeResult,
} from '@/lib/supabase/types'

export async function completeForcedPasswordChange(
  input: ForcedPasswordChangeInput
): Promise<ForcedPasswordChangeResult> {
  try {
    const validation = validateInviteCompletionInput(input)
    if (!validation.success) {
      return {
        success: false,
        errorCode: validation.errorCode,
        message: validation.message,
      }
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError) {
      logger.error('auth/changePassword/getUser', authError)
    }

    if (!user?.id || !user.email) {
      return {
        success: false,
        errorCode: 'PASSWORD_CHANGE_AUTH_REQUIRED',
        message: 'Sign in with your temporary password first.',
      }
    }

    if (!mustChangePassword(user.app_metadata)) {
      return {
        success: false,
        errorCode: 'PASSWORD_CHANGE_NOT_REQUIRED',
        message: 'Your password has already been set. Continue to the app.',
      }
    }

    const { error: updateUserError } = await supabase.auth.updateUser({
      password: validation.values.password,
    })

    if (updateUserError) {
      logger.error('auth/changePassword/updateUser', updateUserError, { userId: user.id })
      return {
        success: false,
        errorCode: updateUserError.code ?? 'PASSWORD_CHANGE_UPDATE_FAILED',
        message: updateUserError.message,
      }
    }

    const adminSupabase = createAdminClient()
    const { error: flagClearError } = await adminSupabase.auth.admin.updateUserById(user.id, {
      app_metadata: { [MUST_CHANGE_PASSWORD_FLAG]: false },
    })

    if (flagClearError) {
      logger.error('auth/changePassword/clearFlag', flagClearError, { userId: user.id })
      return {
        success: false,
        errorCode: 'PASSWORD_CHANGE_FLAG_CLEAR_FAILED',
        message: 'Your password was changed, but finishing setup failed. Try submitting again.',
      }
    }

    // First password change doubles as invite acceptance for accounts created at clinic
    // approval: sync the name/mobile captured on the onboarding request and mark the invite
    // accepted. Non-fatal — the password is already changed, so a failure here must not force
    // the user back through the form.
    const normalizedEmail = normalizeEmail(user.email)
    const { data: invite, error: inviteError } = await adminSupabase
      .from('user_invites')
      .select('*')
      .eq('email', normalizedEmail)
      .eq('status', 'pending')
      .maybeSingle()

    if (inviteError) {
      logger.warn('auth/changePassword/inviteLookup', inviteError, { userId: user.id })
    } else if (invite && (!invite.auth_user_id || invite.auth_user_id === user.id)) {
      const now = new Date().toISOString()
      const { error: profileError } = await adminSupabase.from('profiles').upsert(
        {
          id: user.id,
          clinic_id: invite.clinic_id,
          email: normalizedEmail,
          role: invite.role,
          full_name: invite.full_name,
          mobile_number: invite.mobile_number,
          updated_at: now,
        },
        { onConflict: 'id' }
      )

      if (profileError) {
        logger.warn('auth/changePassword/upsertProfile', profileError, {
          userId: user.id,
          inviteId: invite.id,
        })
      }

      const { error: acceptError } = await adminSupabase
        .from('user_invites')
        .update({
          status: 'accepted',
          auth_user_id: user.id,
          accepted_at: now,
          revoked_at: null,
          updated_at: now,
        })
        .eq('id', invite.id)
        .eq('status', 'pending')

      if (acceptError) {
        logger.warn('auth/changePassword/acceptInvite', acceptError, {
          userId: user.id,
          inviteId: invite.id,
        })
      }
    }

    return {
      success: true,
    }
  } catch (error) {
    // `input` is `{ password, passwordConfirmation }` — the credential itself. It must never
    // reach the log drain, so this path logs the error alone.
    logger.error('auth/changePassword/unexpected', error)
    return {
      success: false,
      errorCode: 'PASSWORD_CHANGE_FAILED',
      message: getInviteErrorMessage(error),
    }
  }
}
