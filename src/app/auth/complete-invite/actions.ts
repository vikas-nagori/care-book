'use server'

import { revalidatePath } from 'next/cache'
import { logger } from '@/lib/logger'
import { validateInviteCompletionInput, normalizeEmail } from '@/lib/onboarding/invite-helpers'
import { getInviteErrorMessage } from '@/lib/onboarding/invite-server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type {
  CompleteInvitedSignupInput,
  CompleteInvitedSignupResult,
} from '@/lib/supabase/types'

export async function completeInvitedSignup(
  input: CompleteInvitedSignupInput
): Promise<CompleteInvitedSignupResult> {
  try {
    const validation = validateInviteCompletionInput(input)
    if (!validation.success) {
      return {
        success: false,
        errorCode: 'INVITE_COMPLETION_INVALID',
        message: validation.message,
      }
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError) {
      logger.error('auth/completeInvite/getUser', authError)
    }

    if (!user?.id || !user.email) {
      return {
        success: false,
        errorCode: 'INVITE_AUTH_REQUIRED',
        message: 'Open the invite link from your email before finishing sign-up.',
      }
    }

    const adminSupabase = createAdminClient()
    const normalizedEmail = normalizeEmail(user.email)
    const { data: invite, error: inviteError } = await adminSupabase
      .from('user_invites')
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (inviteError) {
      logger.error('auth/completeInvite/inviteLookup', inviteError, {
        email: normalizedEmail,
        userId: user.id,
      })
      return {
        success: false,
        errorCode: inviteError.code ?? 'INVITE_LOOKUP_FAILED',
        message: 'Unable to load your invite right now.',
      }
    }

    if (!invite) {
      return {
        success: false,
        errorCode: 'INVITE_NOT_FOUND',
        message: 'No pending invite was found for this signed-in email address.',
      }
    }

    if (invite.status !== 'pending') {
      return {
        success: false,
        errorCode: 'INVITE_NOT_PENDING',
        message:
          invite.status === 'revoked'
            ? 'This invite was revoked. Ask an admin to send a new one.'
            : 'This invite has already been completed. Please sign in normally.',
      }
    }

    if (invite.auth_user_id && invite.auth_user_id !== user.id) {
      return {
        success: false,
        errorCode: 'INVITE_EMAIL_MISMATCH',
        message: 'This invite belongs to a different account. Use the original invite email.',
      }
    }

    const { error: updateUserError } = await supabase.auth.updateUser({
      password: validation.values.password,
    })

    if (updateUserError) {
      logger.error('auth/completeInvite/updateUser', updateUserError, { userId: user.id })
      return {
        success: false,
        errorCode: updateUserError.code ?? 'INVITE_PASSWORD_UPDATE_FAILED',
        message: updateUserError.message,
      }
    }

    // Name and mobile are captured by the admin at invite time, so they come
    // from the invite record rather than the setup form.
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
      logger.error('auth/completeInvite/upsertProfile', profileError, {
        userId: user.id,
        email: normalizedEmail,
        inviteId: invite.id,
      })
      return {
        success: false,
        errorCode: profileError.code ?? 'INVITE_PROFILE_SAVE_FAILED',
        message: 'Your password was set, but saving your profile failed.',
      }
    }

    const { data: acceptedInvite, error: acceptError } = await adminSupabase
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
      .select('id')
      .maybeSingle()

    if (acceptError || !acceptedInvite) {
      logger.error('auth/completeInvite/acceptInvite', acceptError, {
        userId: user.id,
        inviteId: invite.id,
      })
      return {
        success: false,
        errorCode: acceptError?.code ?? 'INVITE_ACCEPT_FAILED',
        message: 'Your password was set, but the invite could not be marked as accepted.',
      }
    }

    if (invite.external_staff_id) {
      const { error: externalStaffError } = await adminSupabase
        .from('external_staff')
        .update({
          status: 'onboarded',
          linked_profile_id: user.id,
          email: normalizedEmail,
        })
        .eq('id', invite.external_staff_id)
        .eq('clinic_id', invite.clinic_id)

      if (externalStaffError) {
        logger.error('auth/completeInvite/linkExternalStaff', externalStaffError, {
          userId: user.id,
          inviteId: invite.id,
          externalStaffId: invite.external_staff_id,
        })
        return {
          success: false,
          errorCode: externalStaffError.code ?? 'INVITE_EXTERNAL_STAFF_LINK_FAILED',
          message: 'Your account was created, but linking the external staff record failed.',
        }
      }
    }

    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) {
      logger.warn('auth/completeInvite/signOut', signOutError.message, {
        userId: user.id,
      })
    }

    revalidatePath('/settings')

    return {
      success: true,
    }
  } catch (error) {
    // `input` is `{ password, passwordConfirmation }` — the credential itself. It must never
    // reach the log drain, so this path logs the error alone. The signed-in user is already
    // identified on every earlier logger.error in this action.
    logger.error('auth/completeInvite/unexpected', error)
    return {
      success: false,
      errorCode: 'INVITE_COMPLETION_FAILED',
      message: getInviteErrorMessage(error),
    }
  }
}
