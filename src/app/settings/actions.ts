'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getCurrentProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildInviteRedirectTo,
  getInviteErrorMessage,
} from '@/lib/onboarding/invite-server'
import { getInviteCollisionResult, validateInviteInput } from '@/lib/onboarding/invite-helpers'
import type {
  CreateUserInviteInput,
  CreateExternalStaffInput,
  CreateExternalStaffResult,
  CreateUserInviteResult,
  ManageUserInviteInput,
  ManageUserInviteResult,
  UpdateGlobalSettingsInput,
  UpdateGlobalSettingsResult,
  ExternalStaff,
  UserInvite,
} from '@/lib/supabase/types'

async function requireAdminSettingsAccess() {
  const profile = await getCurrentProfile()
  if (!profile || profile.role !== 'admin' || !profile.clinic_id) {
    return null
  }

  return profile
}

export async function logoutFromSettings(): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut()

  if (error) {
    logger.error('settings/logoutFromSettings', error)
  }

  redirect('/login')
}

function createServerAuthClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }

  return createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}

function isMissingExternalStaffSchemaError(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === 'PGRST205' ||
    error?.code === '42P01' ||
    (error?.message?.includes('external_staff') && error.message.includes('schema cache'))
  )
}

export async function updateGlobalSettings(
  input: UpdateGlobalSettingsInput
): Promise<UpdateGlobalSettingsResult> {
  try {
    const profile = await requireAdminSettingsAccess()
    if (!profile) {
      return {
        success: false,
        errorCode: 'SETTINGS_UNAUTHORIZED',
        message: 'Only admins can update session fees.',
      }
    }

    if (!Number.isFinite(input.clinicFee) || input.clinicFee < 0) {
      return {
        success: false,
        errorCode: 'INVALID_CLINIC_FEE',
        message: 'Clinic fee must be zero or more.',
      }
    }

    if (!Number.isFinite(input.homeVisitFee) || input.homeVisitFee < 0) {
      return {
        success: false,
        errorCode: 'INVALID_HOME_VISIT_FEE',
        message: 'Home visit fee must be zero or more.',
      }
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('global_settings')
      .upsert(
        {
          clinic_id: profile.clinic_id,
          clinic_fee: input.clinicFee,
          home_visit_fee: input.homeVisitFee,
        },
        { onConflict: 'clinic_id' }
      )
      .select('*')
      .single()

    if (error || !data) {
      logger.error('settings/updateGlobalSettings', error, input)
      return {
        success: false,
        errorCode: error?.code ?? 'SETTINGS_UPDATE_FAILED',
        message: error?.message ?? 'Unable to update settings right now.',
      }
    }

    revalidatePath('/settings')
    revalidatePath('/schedule')
    revalidatePath('/schedule/new')

    return {
      success: true,
      settings: data,
    }
  } catch (error) {
    logger.error('settings/updateGlobalSettings/unexpected', error, input)
    return {
      success: false,
      errorCode: 'SETTINGS_UPDATE_FAILED',
      message: 'Unable to update settings right now.',
    }
  }
}

export async function createUserInvite(
  input: CreateUserInviteInput
): Promise<CreateUserInviteResult> {
  try {
    const profile = await requireAdminSettingsAccess()
    if (!profile) {
      return {
        success: false,
        errorCode: 'INVITE_UNAUTHORIZED',
        message: 'Only admins can invite users.',
      }
    }

    const validation = validateInviteInput(input)
    if (!validation.success) {
      return {
        success: false,
        errorCode: 'INVITE_INVALID_INPUT',
        message: validation.message,
      }
    }

    const adminSupabase = createAdminClient()
    const email = validation.values.email
    const redirectTo = await buildInviteRedirectTo()
    const externalStaffId = input.externalStaffId || null
    const clinicId = profile.clinic_id
    if (!clinicId) {
      return {
        success: false,
        errorCode: 'INVITE_UNAUTHORIZED',
        message: 'Only admins can invite users.',
      }
    }

    if (externalStaffId) {
      const { data: externalStaff, error: externalStaffLookupError } = await adminSupabase
        .from('external_staff')
        .select('id')
        .eq('id', externalStaffId)
        .eq('clinic_id', clinicId)
        .maybeSingle()

      if (externalStaffLookupError) {
        logger.error('settings/createUserInvite/externalStaffLookup', externalStaffLookupError, {
          externalStaffId,
          clinicId,
        })
        return {
          success: false,
          errorCode: externalStaffLookupError.code ?? 'INVITE_EXTERNAL_STAFF_LOOKUP_FAILED',
          message: 'Unable to check the external staff record right now.',
        }
      }

      if (!externalStaff) {
        return {
          success: false,
          errorCode: 'INVITE_EXTERNAL_STAFF_NOT_FOUND',
          message: 'Choose an external staff record from your clinic.',
        }
      }
    }

    const [{ data: existingInvite, error: inviteLookupError }, { data: existingProfile, error: profileLookupError }] =
      await Promise.all([
        adminSupabase
          .from('user_invites')
          .select('*')
          .eq('email', email)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        adminSupabase.from('profiles').select('id, email').eq('email', email).maybeSingle(),
      ])

    if (inviteLookupError) {
      logger.error('settings/createUserInvite/inviteLookup', inviteLookupError, { email })
      return {
        success: false,
        errorCode: inviteLookupError.code ?? 'INVITE_LOOKUP_FAILED',
        message: 'Unable to check existing invites right now.',
      }
    }

    if (profileLookupError) {
      logger.error('settings/createUserInvite/profileLookup', profileLookupError, { email })
      return {
        success: false,
        errorCode: profileLookupError.code ?? 'PROFILE_LOOKUP_FAILED',
        message: 'Unable to check existing users right now.',
      }
    }

    const collision = getInviteCollisionResult({
      currentClinicId: clinicId,
      existingInvite,
      existingProfile,
    })

    if (collision === 'already_pending') {
      return {
        success: false,
        errorCode: 'INVITE_ALREADY_PENDING',
        message: 'A pending invite already exists for this email address.',
      }
    }

    if (collision === 'already_active') {
      return {
        success: false,
        errorCode: 'INVITE_USER_ALREADY_ACTIVE',
        message: 'This email address already belongs to an active user.',
      }
    }

    if (collision === 'conflict') {
      return {
        success: false,
        errorCode: 'INVITE_EMAIL_UNAVAILABLE',
        message: 'This email address cannot be invited.',
      }
    }

    const { data: inviteUserData, error: inviteUserError } =
      await adminSupabase.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { role: validation.values.role },
      })

    if (inviteUserError) {
      logger.error('settings/createUserInvite/inviteUserByEmail', inviteUserError, {
        email,
        role: validation.values.role,
      })
      return {
        success: false,
        errorCode: inviteUserError.code ?? 'INVITE_CREATE_FAILED',
        message: getInviteErrorMessage(inviteUserError),
      }
    }

    const now = new Date().toISOString()
    const invitePayload = {
      clinic_id: clinicId,
      email,
      role: validation.values.role,
      status: 'pending' as const,
      auth_user_id: inviteUserData.user?.id ?? existingInvite?.auth_user_id ?? null,
      external_staff_id: externalStaffId,
      invited_by: profile.id,
      accepted_at: null,
      revoked_at: null,
      updated_at: now,
    }

    const inviteMutation = collision === 'reuse_revoked_invite' && existingInvite
      ? adminSupabase
          .from('user_invites')
          .update(invitePayload)
          .eq('id', existingInvite.id)
          .eq('clinic_id', clinicId)
          .eq('status', 'revoked')
          .select('*')
          .single()
      : adminSupabase
          .from('user_invites')
          .insert(invitePayload)
          .select('*')
          .single()

    const { data: invite, error: inviteSaveError } = await inviteMutation

    if (inviteSaveError || !invite) {
      logger.error('settings/createUserInvite/saveInvite', inviteSaveError, {
        email,
        role: validation.values.role,
      })
      return {
        success: false,
        errorCode: inviteSaveError?.code ?? 'INVITE_CREATE_FAILED',
        message: 'Invite email was sent, but saving the invite record failed.',
      }
    }

    if (externalStaffId) {
      const { error: externalStaffUpdateError } = await adminSupabase
        .from('external_staff')
        .update({ email })
        .eq('id', externalStaffId)
        .eq('clinic_id', clinicId)
        .is('linked_profile_id', null)

      if (externalStaffUpdateError) {
        logger.warn('settings/createUserInvite/updateExternalStaff', externalStaffUpdateError.message, {
          externalStaffId,
          email,
        })
      }
    }

    revalidatePath('/settings')

    return {
      success: true,
      invite: invite as UserInvite,
    }
  } catch (error) {
    logger.error('settings/createUserInvite/unexpected', error, input)
    return {
      success: false,
      errorCode: 'INVITE_CREATE_FAILED',
      message: getInviteErrorMessage(error),
    }
  }
}

export async function createExternalStaff(
  input: CreateExternalStaffInput
): Promise<CreateExternalStaffResult> {
  try {
    const profile = await requireAdminSettingsAccess()
    if (!profile) {
      return {
        success: false,
        errorCode: 'EXTERNAL_STAFF_UNAUTHORIZED',
        message: 'Only admins can create external staff.',
      }
    }

    const name = input.name.trim()
    const phone = input.phone.trim()
    const email = input.email?.trim().toLowerCase() || null
    const notes = input.notes?.trim() || null

    if (!name) {
      return {
        success: false,
        errorCode: 'EXTERNAL_STAFF_MISSING_NAME',
        message: 'Enter the external staff name.',
      }
    }

    if (!phone) {
      return {
        success: false,
        errorCode: 'EXTERNAL_STAFF_MISSING_PHONE',
        message: 'Enter the external staff phone number.',
      }
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('external_staff')
      .insert({
        clinic_id: profile.clinic_id,
        name,
        phone,
        email,
        notes,
        created_by: profile.id,
      })
      .select('*')
      .single()

    if (error || !data) {
      logger.error('settings/createExternalStaff', error, { name, phone, email })
      if (isMissingExternalStaffSchemaError(error)) {
        return {
          success: false,
          errorCode: 'EXTERNAL_STAFF_SCHEMA_MISSING',
          message: 'External Staff setup is pending. Apply migration 017_external_staff_payment_due.sql first.',
        }
      }

      return {
        success: false,
        errorCode: error?.code ?? 'EXTERNAL_STAFF_CREATE_FAILED',
        message: error?.message ?? 'Unable to create external staff right now.',
      }
    }

    revalidatePath('/settings')
    revalidatePath('/schedule')
    revalidatePath('/schedule/new')
    revalidatePath('/')

    return {
      success: true,
      externalStaff: data as ExternalStaff,
    }
  } catch (error) {
    logger.error('settings/createExternalStaff/unexpected', error, input)
    return {
      success: false,
      errorCode: 'EXTERNAL_STAFF_CREATE_FAILED',
      message: 'Unable to create external staff right now.',
    }
  }
}

export async function resendUserInvite(
  input: ManageUserInviteInput
): Promise<ManageUserInviteResult> {
  try {
    const profile = await requireAdminSettingsAccess()
    if (!profile) {
      return {
        success: false,
        errorCode: 'INVITE_UNAUTHORIZED',
        message: 'Only admins can resend invites.',
      }
    }

    if (!input.inviteId) {
      return {
        success: false,
        errorCode: 'INVITE_ID_REQUIRED',
        message: 'Choose an invite to resend.',
      }
    }

    const adminSupabase = createAdminClient()
    const { data: invite, error: inviteError } = await adminSupabase
      .from('user_invites')
      .select('*')
      .eq('id', input.inviteId)
      .eq('clinic_id', profile.clinic_id)
      .maybeSingle()

    if (inviteError) {
      logger.error('settings/resendUserInvite/lookup', inviteError, { inviteId: input.inviteId })
      return {
        success: false,
        errorCode: inviteError.code ?? 'INVITE_LOOKUP_FAILED',
        message: 'Unable to load this invite right now.',
      }
    }

    if (!invite || invite.status !== 'pending') {
      return {
        success: false,
        errorCode: 'INVITE_NOT_PENDING',
        message: 'Only pending invites can be resent.',
      }
    }

    const redirectTo = await buildInviteRedirectTo()
    const serverAuthClient = createServerAuthClient()
    const { error: resendError } = await serverAuthClient.auth.resend({
      type: 'signup',
      email: invite.email,
      options: {
        emailRedirectTo: redirectTo,
      },
    })

    if (resendError) {
      logger.warn(
        'settings/resendUserInvite/resendFallback',
        'Signup resend failed, retrying with inviteUserByEmail.',
        {
          inviteId: invite.id,
          email: invite.email,
          error: resendError.message,
        }
      )

      const { error: inviteUserError } = await adminSupabase.auth.admin.inviteUserByEmail(
        invite.email,
        {
          redirectTo,
          data: { role: invite.role },
        }
      )

      if (inviteUserError) {
        logger.error('settings/resendUserInvite/inviteUserByEmail', inviteUserError, {
          inviteId: invite.id,
          email: invite.email,
        })
        return {
          success: false,
          errorCode: inviteUserError.code ?? resendError.code ?? 'INVITE_RESEND_FAILED',
          message: getInviteErrorMessage(inviteUserError),
        }
      }
    }

    const { data: updatedInvite, error: updateError } = await adminSupabase
      .from('user_invites')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', invite.id)
      .eq('clinic_id', profile.clinic_id)
      .select('*')
      .single()

    if (updateError || !updatedInvite) {
      logger.error('settings/resendUserInvite/update', updateError, { inviteId: invite.id })
      return {
        success: false,
        errorCode: updateError?.code ?? 'INVITE_RESEND_FAILED',
        message: 'Invite email was sent, but the invite record could not be refreshed.',
      }
    }

    revalidatePath('/settings')

    return {
      success: true,
      invite: updatedInvite as UserInvite,
    }
  } catch (error) {
    logger.error('settings/resendUserInvite/unexpected', error, input)
    return {
      success: false,
      errorCode: 'INVITE_RESEND_FAILED',
      message: getInviteErrorMessage(error),
    }
  }
}

export async function revokeUserInvite(
  input: ManageUserInviteInput
): Promise<ManageUserInviteResult> {
  try {
    const profile = await requireAdminSettingsAccess()
    if (!profile) {
      return {
        success: false,
        errorCode: 'INVITE_UNAUTHORIZED',
        message: 'Only admins can revoke invites.',
      }
    }

    if (!input.inviteId) {
      return {
        success: false,
        errorCode: 'INVITE_ID_REQUIRED',
        message: 'Choose an invite to revoke.',
      }
    }

    const adminSupabase = createAdminClient()
    const now = new Date().toISOString()
    const { data: invite, error } = await adminSupabase
      .from('user_invites')
      .update({
        status: 'revoked',
        revoked_at: now,
        updated_at: now,
      })
      .eq('id', input.inviteId)
      .eq('clinic_id', profile.clinic_id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle()

    if (error) {
      logger.error('settings/revokeUserInvite/update', error, { inviteId: input.inviteId })
      return {
        success: false,
        errorCode: error.code ?? 'INVITE_REVOKE_FAILED',
        message: 'Unable to revoke this invite right now.',
      }
    }

    if (!invite) {
      return {
        success: false,
        errorCode: 'INVITE_NOT_PENDING',
        message: 'Only pending invites can be revoked.',
      }
    }

    revalidatePath('/settings')

    return {
      success: true,
      invite: invite as UserInvite,
    }
  } catch (error) {
    logger.error('settings/revokeUserInvite/unexpected', error, input)
    return {
      success: false,
      errorCode: 'INVITE_REVOKE_FAILED',
      message: getInviteErrorMessage(error),
    }
  }
}
