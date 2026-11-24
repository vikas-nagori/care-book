'use server'

import { quoteFilterValue } from '@/lib/supabase/postgrest-filter'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { isActiveMcpProfile } from '@/lib/mcp/access'
import { getCurrentProfile } from '@/lib/auth'
import { normalizeMobileNumber, toAuthPhone } from '@/lib/auth/mobile-number'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  closeRevokedInviteeAccount,
  verifyInviteeAccountForClinic,
  getInviteErrorMessage,
  provisionInviteeAccount,
  syncInvitedProfile,
} from '@/lib/onboarding/invite-server'
import {
  getInviteCollisionResult,
  validateInviteCompletionInput,
  validateInviteInput,
} from '@/lib/onboarding/invite-helpers'
import { validateAppointmentTypeInput } from '@/lib/appointments/appointment-type'
import { validatePackageTemplateInput } from '@/lib/billing/package-template'
import type {
  AppointmentTypeResult,
  ChangeOwnPasswordInput,
  ChangeOwnPasswordResult,
  CreateAppointmentTypeInput,
  CreatePackageTemplateInput,
  CreateUserInviteInput,
  CreateExternalStaffInput,
  CreateExternalStaffResult,
  CreateUserInviteResult,
  DeleteAppointmentTypeResult,
  DeletePackageTemplateResult,
  IssueInviteTempPasswordResult,
  ManageUserInviteInput,
  ManageUserInviteResult,
  PackageTemplateResult,
  UpdateAppointmentTypeInput,
  UpdateGlobalSettingsInput,
  UpdatePackageTemplateInput,
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

export async function revokeConnectedMcpApp(formData: FormData): Promise<void> {
  const profile = await getCurrentProfile()
  const grantId = String(formData.get('grant_id') ?? '')
  if (!isActiveMcpProfile(profile) || !grantId) return
  const { error } = await (await createClient())
    .from('mcp_access_grants')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', grantId)
  if (error) logger.error('settings/revokeConnectedMcpApp', error, { grantId })
  revalidatePath('/settings')
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

async function nextAppointmentTypeSortOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
): Promise<number> {
  const { data } = await supabase
    .from('appointment_types')
    .select('sort_order')
    .eq('clinic_id', clinicId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.sort_order ?? -1) + 1
}

export async function createAppointmentType(
  input: CreateAppointmentTypeInput
): Promise<AppointmentTypeResult> {
  try {
    const profile = await requireAdminSettingsAccess()
    if (!profile) {
      return {
        success: false,
        errorCode: 'APPOINTMENT_TYPE_UNAUTHORIZED',
        message: 'Only admins can manage appointment types.',
      }
    }

    const validation = validateAppointmentTypeInput(input)
    if (!validation.success) {
      return validation
    }

    const clinicId = profile.clinic_id
    if (!clinicId) {
      return {
        success: false,
        errorCode: 'APPOINTMENT_TYPE_UNAUTHORIZED',
        message: 'Only admins can manage appointment types.',
      }
    }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('appointment_types')
      .insert({
        clinic_id: clinicId,
        name: validation.values.name,
        session_rate: validation.values.sessionRate,
        is_shared: validation.values.isShared,
        sort_order: await nextAppointmentTypeSortOrder(supabase, clinicId),
      })
      .select('*')
      .single()

    if (error || !data) {
      logger.error('settings/createAppointmentType', error, input)
      return {
        success: false,
        errorCode: error?.code ?? 'APPOINTMENT_TYPE_SAVE_FAILED',
        message:
          error?.code === '23505'
            ? 'An appointment type with that name already exists.'
            : error?.message ?? 'Unable to save this appointment type right now.',
      }
    }

    revalidatePath('/settings')
    revalidatePath('/schedule')
    revalidatePath('/schedule/new')
    return { success: true, appointmentType: data }
  } catch (error) {
    logger.error('settings/createAppointmentType/unexpected', error, input)
    return {
      success: false,
      errorCode: 'APPOINTMENT_TYPE_SAVE_FAILED',
      message: 'Unable to save this appointment type right now.',
    }
  }
}

export async function updateAppointmentType(
  input: UpdateAppointmentTypeInput
): Promise<AppointmentTypeResult> {
  try {
    const profile = await requireAdminSettingsAccess()
    if (!profile) {
      return {
        success: false,
        errorCode: 'APPOINTMENT_TYPE_UNAUTHORIZED',
        message: 'Only admins can manage appointment types.',
      }
    }

    if (!input.id) {
      return {
        success: false,
        errorCode: 'APPOINTMENT_TYPE_MISSING_ID',
        message: 'Choose an appointment type to update.',
      }
    }

    const validation = validateAppointmentTypeInput(input)
    if (!validation.success) {
      return validation
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('appointment_types')
      .update({
        name: validation.values.name,
        session_rate: validation.values.sessionRate,
        is_shared: validation.values.isShared,
      })
      .eq('id', input.id)
      .eq('clinic_id', profile.clinic_id)
      .select('*')
      .single()

    if (error || !data) {
      logger.error('settings/updateAppointmentType', error, input)
      return {
        success: false,
        errorCode: error?.code ?? 'APPOINTMENT_TYPE_SAVE_FAILED',
        message:
          error?.code === '23505'
            ? 'An appointment type with that name already exists.'
            : error?.message ?? 'Unable to update this appointment type right now.',
      }
    }

    revalidatePath('/settings')
    revalidatePath('/schedule')
    revalidatePath('/schedule/new')
    return { success: true, appointmentType: data }
  } catch (error) {
    logger.error('settings/updateAppointmentType/unexpected', error, input)
    return {
      success: false,
      errorCode: 'APPOINTMENT_TYPE_SAVE_FAILED',
      message: 'Unable to update this appointment type right now.',
    }
  }
}

export async function deleteAppointmentType(
  id: string
): Promise<DeleteAppointmentTypeResult> {
  try {
    const profile = await requireAdminSettingsAccess()
    if (!profile) {
      return {
        success: false,
        errorCode: 'APPOINTMENT_TYPE_UNAUTHORIZED',
        message: 'Only admins can manage appointment types.',
      }
    }

    if (!id) {
      return {
        success: false,
        errorCode: 'APPOINTMENT_TYPE_MISSING_ID',
        message: 'Choose an appointment type to delete.',
      }
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from('appointment_types')
      .delete()
      .eq('id', id)
      .eq('clinic_id', profile.clinic_id)

    if (error) {
      logger.error('settings/deleteAppointmentType', error, { id })
      return {
        success: false,
        errorCode: error.code ?? 'APPOINTMENT_TYPE_DELETE_FAILED',
        message:
          error.code === '23503'
            ? 'This type is used by existing appointments and cannot be deleted.'
            : error.message,
      }
    }

    revalidatePath('/settings')
    revalidatePath('/schedule')
    revalidatePath('/schedule/new')
    return { success: true, id }
  } catch (error) {
    logger.error('settings/deleteAppointmentType/unexpected', error, { id })
    return {
      success: false,
      errorCode: 'APPOINTMENT_TYPE_DELETE_FAILED',
      message: 'Unable to delete this appointment type right now.',
    }
  }
}

export async function createPackageTemplate(
  input: CreatePackageTemplateInput
): Promise<PackageTemplateResult> {
  try {
    const profile = await requireAdminSettingsAccess()
    if (!profile) {
      return {
        success: false,
        errorCode: 'PACKAGE_TEMPLATE_UNAUTHORIZED',
        message: 'Only admins can manage package templates.',
      }
    }

    const validation = validatePackageTemplateInput(input)
    if (!validation.success) {
      return validation
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('package_templates')
      .insert({
        clinic_id: profile.clinic_id,
        name: validation.values.name,
        min_sessions: validation.values.minSessions,
        per_session_amount: validation.values.perSessionAmount,
      })
      .select('*')
      .single()

    if (error || !data) {
      logger.error('settings/createPackageTemplate', error, input)
      return {
        success: false,
        errorCode: error?.code ?? 'PACKAGE_TEMPLATE_SAVE_FAILED',
        message: error?.message ?? 'Unable to save this template right now.',
      }
    }

    revalidatePath('/settings')
    revalidatePath('/billing')
    return { success: true, template: data }
  } catch (error) {
    logger.error('settings/createPackageTemplate/unexpected', error, input)
    return {
      success: false,
      errorCode: 'PACKAGE_TEMPLATE_SAVE_FAILED',
      message: 'Unable to save this template right now.',
    }
  }
}

export async function updatePackageTemplate(
  input: UpdatePackageTemplateInput
): Promise<PackageTemplateResult> {
  try {
    const profile = await requireAdminSettingsAccess()
    if (!profile) {
      return {
        success: false,
        errorCode: 'PACKAGE_TEMPLATE_UNAUTHORIZED',
        message: 'Only admins can manage package templates.',
      }
    }

    if (!input.id) {
      return {
        success: false,
        errorCode: 'PACKAGE_TEMPLATE_MISSING_ID',
        message: 'Choose a template to update.',
      }
    }

    const validation = validatePackageTemplateInput(input)
    if (!validation.success) {
      return validation
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('package_templates')
      .update({
        name: validation.values.name,
        min_sessions: validation.values.minSessions,
        per_session_amount: validation.values.perSessionAmount,
      })
      .eq('id', input.id)
      .eq('clinic_id', profile.clinic_id)
      .select('*')
      .single()

    if (error || !data) {
      logger.error('settings/updatePackageTemplate', error, input)
      return {
        success: false,
        errorCode: error?.code ?? 'PACKAGE_TEMPLATE_SAVE_FAILED',
        message: error?.message ?? 'Unable to update this template right now.',
      }
    }

    revalidatePath('/settings')
    revalidatePath('/billing')
    return { success: true, template: data }
  } catch (error) {
    logger.error('settings/updatePackageTemplate/unexpected', error, input)
    return {
      success: false,
      errorCode: 'PACKAGE_TEMPLATE_SAVE_FAILED',
      message: 'Unable to update this template right now.',
    }
  }
}

export async function deletePackageTemplate(
  id: string
): Promise<DeletePackageTemplateResult> {
  try {
    const profile = await requireAdminSettingsAccess()
    if (!profile) {
      return {
        success: false,
        errorCode: 'PACKAGE_TEMPLATE_UNAUTHORIZED',
        message: 'Only admins can manage package templates.',
      }
    }

    if (!id) {
      return {
        success: false,
        errorCode: 'PACKAGE_TEMPLATE_MISSING_ID',
        message: 'Choose a template to delete.',
      }
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from('package_templates')
      .delete()
      .eq('id', id)
      .eq('clinic_id', profile.clinic_id)

    if (error) {
      logger.error('settings/deletePackageTemplate', error, { id })
      return {
        success: false,
        errorCode: error.code ?? 'PACKAGE_TEMPLATE_DELETE_FAILED',
        message: error.message,
      }
    }

    revalidatePath('/settings')
    revalidatePath('/billing')
    return { success: true, id }
  } catch (error) {
    logger.error('settings/deletePackageTemplate/unexpected', error, { id })
    return {
      success: false,
      errorCode: 'PACKAGE_TEMPLATE_DELETE_FAILED',
      message: 'Unable to delete this template right now.',
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

    const externalStaffId = input.externalStaffId || null
    if (externalStaffId && validation.values.role === 'external_staff') {
      return {
        success: false,
        errorCode: 'INVITE_INVALID_INPUT',
        message: 'Invite External Staff from Invite User without linking a Temporary Staff record.',
      }
    }

    const adminSupabase = createAdminClient()
    const email = validation.values.email
    const mobileNumber = validation.values.mobileNumber
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
          message: 'Unable to check the temporary staff record right now.',
        }
      }

      if (!externalStaff) {
        return {
          success: false,
          errorCode: 'INVITE_EXTERNAL_STAFF_NOT_FOUND',
          message: 'Choose a temporary staff record from your clinic.',
        }
      }
    }

    // The mobile number is the login, so it is what identifies "the same person" across invites
    // and existing users. An email, when given, must not belong to someone else either.
    const contactFilter = email
      ? `mobile_number.eq.${quoteFilterValue(mobileNumber)},email.eq.${quoteFilterValue(email)}`
      : `mobile_number.eq.${quoteFilterValue(mobileNumber)}`
    const [{ data: existingInvites, error: inviteLookupError }, { data: existingProfiles, error: profileLookupError }] =
      await Promise.all([
        adminSupabase
          .from('user_invites')
          .select('*')
          .or(contactFilter)
          .order('created_at', { ascending: false })
          .limit(5),
        adminSupabase.from('profiles').select('id, email, status, mobile_number').or(contactFilter).limit(5),
      ])
    const existingInvite = existingInvites?.[0] ?? null
    const existingProfile = existingProfiles?.[0] ?? null
    // Number and email pointing at two different people is never a re-invite of either.
    const contactsSplit =
      new Set((existingProfiles ?? []).map((row) => row.id)).size > 1 ||
      new Set((existingInvites ?? []).map((row) => row.auth_user_id ?? row.id)).size > 1

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

    const collision = contactsSplit
      ? 'conflict'
      : getInviteCollisionResult({
          currentClinicId: clinicId,
          existingInvite,
          existingProfile,
        })

    if (collision === 'already_pending') {
      return {
        success: false,
        errorCode: 'INVITE_ALREADY_PENDING',
        message: 'A pending invite already exists for this mobile number.',
      }
    }

    if (collision === 'already_active') {
      return {
        success: false,
        errorCode: 'INVITE_USER_ALREADY_ACTIVE',
        message: 'This mobile number already belongs to an active user.',
      }
    }

    if (collision === 'conflict') {
      return {
        success: false,
        errorCode: 'INVITE_EMAIL_UNAVAILABLE',
        message: 'This mobile number or email cannot be invited.',
      }
    }

    // No invite email (they were not reliably arriving): the invitee gets a one-time temporary
    // password that the admin shares directly, and must set their own on first login.
    const reusedAuthUserId =
      collision === 'reuse_revoked_invite' ? existingInvite?.auth_user_id ?? null : null
    if (reusedAuthUserId) {
      const check = await verifyInviteeAccountForClinic(adminSupabase, reusedAuthUserId, clinicId)
      if (!check.ok) {
        logger.warn('settings/createUserInvite/reuseRefused', null, { reason: check.reason })
        return {
          success: false,
          errorCode: 'INVITE_EMAIL_UNAVAILABLE',
          message: 'This mobile number or email cannot be invited.',
        }
      }
    }

    const account = await provisionInviteeAccount(adminSupabase, {
      email,
      mobileNumber,
      existingAuthUserId: reusedAuthUserId,
    })

    if (account.error) {
      logger.error('settings/createUserInvite/provisionAccount', account.error, {
        email,
        role: validation.values.role,
      })
      return {
        success: false,
        errorCode: account.error.code ?? 'INVITE_CREATE_FAILED',
        message: getInviteErrorMessage(account.error),
      }
    }

    const now = new Date().toISOString()
    const invitePayload = {
      clinic_id: clinicId,
      email,
      role: validation.values.role,
      status: 'pending' as const,
      // Captured here so the password-setup screen never re-asks for them: completeInvitedSignup
      // sources the profile's name and mobile from this record.
      full_name: validation.values.fullName,
      mobile_number: mobileNumber,
      auth_user_id: account.authUserId,
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

    // Same reason as the clinic-owner path: the auth user already exists, so the
    // on_auth_user_created trigger has written a placeholder profile with no clinic. Attach it
    // to this clinic now instead of waiting for the invite to be accepted.
    const { error: profileSyncError } = await syncInvitedProfile(adminSupabase, {
      authUserId: account.authUserId,
      clinicId,
      email,
      role: validation.values.role,
    })

    if (profileSyncError) {
      logger.error('settings/createUserInvite/syncProfile', profileSyncError, {
        email,
        role: validation.values.role,
      })
      return {
        success: false,
        errorCode: profileSyncError.code ?? 'INVITE_PROFILE_SYNC_FAILED',
        message: 'The account was created, but saving the user profile failed.',
      }
    }

    const { data: invite, error: inviteSaveError } = await inviteMutation

    if (inviteSaveError || !invite) {
      logger.error('settings/createUserInvite/saveInvite', inviteSaveError, {
        email,
        role: validation.values.role,
      })
      return {
        success: false,
        errorCode: inviteSaveError?.code ?? 'INVITE_CREATE_FAILED',
        message: 'The account was created, but saving the invite record failed.',
      }
    }

    if (externalStaffId && email) {
      const { error: externalStaffUpdateError } = await adminSupabase
        .from('external_staff')
        .update({ email })
        .eq('id', externalStaffId)
        .eq('clinic_id', clinicId)
        .is('linked_profile_id', null)

      if (externalStaffUpdateError) {
        logger.warn('settings/createUserInvite/updateExternalStaff', externalStaffUpdateError, {
          externalStaffId,
          email,
        })
      }
    }

    revalidatePath('/settings')

    return {
      success: true,
      invite: invite as UserInvite,
      credentials: { mobileNumber, email, tempPassword: account.tempPassword },
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
        message: 'Only admins can add temporary staff.',
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
        message: 'Enter the temporary staff member’s name.',
      }
    }

    if (!phone) {
      return {
        success: false,
        errorCode: 'EXTERNAL_STAFF_MISSING_PHONE',
        message: 'Enter the temporary staff member’s phone number.',
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
          message: 'Temporary Staff setup is pending. Apply migration 017_external_staff_payment_due.sql first.',
        }
      }

      return {
        success: false,
        errorCode: error?.code ?? 'EXTERNAL_STAFF_CREATE_FAILED',
        message: error?.message ?? 'Unable to add temporary staff right now.',
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
      message: 'Unable to add temporary staff right now.',
    }
  }
}

export async function issueInviteTempPassword(
  input: ManageUserInviteInput
): Promise<IssueInviteTempPasswordResult> {
  try {
    const profile = await requireAdminSettingsAccess()
    if (!profile) {
      return {
        success: false,
        errorCode: 'INVITE_UNAUTHORIZED',
        message: 'Only admins can issue temporary passwords.',
      }
    }

    if (!input.inviteId) {
      return {
        success: false,
        errorCode: 'INVITE_ID_REQUIRED',
        message: 'Choose an invite.',
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
      logger.error('settings/issueInviteTempPassword/lookup', inviteError, { inviteId: input.inviteId })
      return {
        success: false,
        errorCode: inviteError.code ?? 'INVITE_LOOKUP_FAILED',
        message: 'Unable to load this invite right now.',
      }
    }

    // Pending means the invitee has never set their own password, so re-issuing cannot clobber
    // one. Accepted users change or reset their own password instead.
    if (!invite || invite.status !== 'pending') {
      return {
        success: false,
        errorCode: 'INVITE_NOT_PENDING',
        message: 'Only pending invites can get a new temporary password.',
      }
    }

    const inviteMobileNumber = normalizeMobileNumber(invite.mobile_number)
    if (!inviteMobileNumber) {
      return {
        success: false,
        errorCode: 'INVITE_INVALID_MOBILE',
        message: 'This invite has no valid mobile number. Revoke it and invite again with one.',
      }
    }

    // Only this clinic's own account (or a revoked, clinic-less placeholder) may be reset: never
    // one found by an unscoped lookup, never another clinic's user, never a platform admin.
    let authUserId: string | null = invite.auth_user_id
    if (!authUserId && invite.email) {
      const { data: invitedProfile } = await adminSupabase
        .from('profiles')
        .select('id')
        .eq('email', invite.email)
        .or(`clinic_id.eq.${profile.clinic_id},clinic_id.is.null`)
        .maybeSingle()
      authUserId = invitedProfile?.id ?? null
    }
    if (authUserId) {
      const check = profile.clinic_id
        ? await verifyInviteeAccountForClinic(adminSupabase, authUserId, profile.clinic_id)
        : ({ ok: false, reason: 'other_clinic' } as const)
      if (!check.ok) {
        logger.warn('settings/issueInviteTempPassword/resetRefused', null, {
          inviteId: invite.id,
          reason: check.reason,
        })
        return {
          success: false,
          errorCode: 'INVITE_TEMP_PASSWORD_FAILED',
          message: 'A new password cannot be issued for this invite.',
        }
      }
    }

    // An invite with no auth identity yet gets one created now.
    const account = await provisionInviteeAccount(adminSupabase, {
      email: invite.email,
      mobileNumber: inviteMobileNumber,
      existingAuthUserId: authUserId,
    })

    if (account.error) {
      logger.error('settings/issueInviteTempPassword/provisionAccount', account.error, {
        inviteId: invite.id,
      })
      return {
        success: false,
        errorCode: account.error.code ?? 'INVITE_TEMP_PASSWORD_FAILED',
        message: getInviteErrorMessage(account.error),
      }
    }

    if (!authUserId) {
      const { error: profileSyncError } = await syncInvitedProfile(adminSupabase, {
        authUserId: account.authUserId,
        clinicId: invite.clinic_id,
        email: invite.email,
        role: invite.role,
      })
      if (profileSyncError) {
        logger.error('settings/issueInviteTempPassword/syncProfile', profileSyncError, {
          inviteId: invite.id,
        })
        return {
          success: false,
          errorCode: profileSyncError.code ?? 'INVITE_PROFILE_SYNC_FAILED',
          message: 'The account was created, but saving the user profile failed.',
        }
      }
    }

    const { data: updatedInvite, error: updateError } = await adminSupabase
      .from('user_invites')
      .update({ auth_user_id: account.authUserId, updated_at: new Date().toISOString() })
      .eq('id', invite.id)
      .eq('clinic_id', profile.clinic_id)
      .select('*')
      .single()

    if (updateError || !updatedInvite) {
      logger.error('settings/issueInviteTempPassword/update', updateError, { inviteId: invite.id })
      return {
        success: false,
        errorCode: updateError?.code ?? 'INVITE_TEMP_PASSWORD_FAILED',
        message: 'The password was reset, but the invite record could not be refreshed.',
      }
    }

    revalidatePath('/settings')

    return {
      success: true,
      invite: updatedInvite as UserInvite,
      credentials: { mobileNumber: inviteMobileNumber, email: invite.email, tempPassword: account.tempPassword },
    }
  } catch (error) {
    logger.error('settings/issueInviteTempPassword/unexpected', error, input)
    return {
      success: false,
      errorCode: 'INVITE_TEMP_PASSWORD_FAILED',
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
    const { data: pendingInvite, error: lookupError } = await adminSupabase
      .from('user_invites')
      .select('id, auth_user_id')
      .eq('id', input.inviteId)
      .eq('clinic_id', profile.clinic_id)
      .eq('status', 'pending')
      .maybeSingle()

    if (lookupError) {
      logger.error('settings/revokeUserInvite/lookup', lookupError, { inviteId: input.inviteId })
      return {
        success: false,
        errorCode: lookupError.code ?? 'INVITE_REVOKE_FAILED',
        message: 'Unable to revoke this invite right now.',
      }
    }

    if (!pendingInvite) {
      return {
        success: false,
        errorCode: 'INVITE_NOT_PENDING',
        message: 'Only pending invites can be revoked.',
      }
    }

    // The invitee may already hold a working temporary password, so flipping the status alone
    // would leave them a live clinic account. Close it first: if that fails the invite stays
    // pending, so the admin can simply revoke again.
    if (pendingInvite.auth_user_id) {
      // Close only an account that is this clinic's own; another clinic's user or a platform
      // admin is never banned through an invite row.
      const check = profile.clinic_id
        ? await verifyInviteeAccountForClinic(adminSupabase, pendingInvite.auth_user_id, profile.clinic_id)
        : ({ ok: false, reason: 'other_clinic' } as const)
      if (!check.ok && check.reason !== 'not_found') {
        logger.warn('settings/revokeUserInvite/closeRefused', null, {
          inviteId: pendingInvite.id,
          reason: check.reason,
        })
        return {
          success: false,
          errorCode: 'INVITE_REVOKE_FAILED',
          message: 'This invite cannot be revoked here. Contact support.',
        }
      }
    }
    if (pendingInvite.auth_user_id) {
      const { error: closeError } = await closeRevokedInviteeAccount(
        adminSupabase,
        pendingInvite.auth_user_id
      )
      if (closeError) {
        logger.error('settings/revokeUserInvite/closeAccount', closeError, { inviteId: pendingInvite.id })
        return {
          success: false,
          errorCode: closeError.code ?? 'INVITE_REVOKE_FAILED',
          message: 'Unable to block this account right now. Try revoking again.',
        }
      }
    }

    const now = new Date().toISOString()
    const { data: invite, error } = await adminSupabase
      .from('user_invites')
      .update({
        status: 'revoked',
        revoked_at: now,
        updated_at: now,
      })
      .eq('id', pendingInvite.id)
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

export async function changeOwnPassword(
  input: ChangeOwnPasswordInput
): Promise<ChangeOwnPasswordResult> {
  try {
    // Any signed-in user may change their own password — staff included — so this only needs
    // a profile, not admin settings access.
    const profile = await getCurrentProfile()
    if (!profile) {
      return {
        success: false,
        errorCode: 'PASSWORD_CHANGE_AUTH_REQUIRED',
        message: 'Sign in to change your password.',
      }
    }

    if (!input.currentPassword) {
      return {
        success: false,
        errorCode: 'PASSWORD_CURRENT_REQUIRED',
        message: 'Enter your current password.',
      }
    }

    const validation = validateInviteCompletionInput({
      password: input.password,
      passwordConfirmation: input.passwordConfirmation,
    })
    if (!validation.success) {
      return {
        success: false,
        errorCode: validation.errorCode,
        message: validation.message,
      }
    }

    // Re-authenticate on the session-less client so a borrowed open session cannot silently
    // take over the account, and so this sign-in never touches the caller's cookies.
    const verifyClient = createServerAuthClient()
    // Re-check with whichever identifier the account signs in with: email when it has one (works
    // even where phone sign-in is off), else its mobile number.
    const mobileNumber = normalizeMobileNumber(profile.mobile_number)
    const identifier = profile.email
      ? { email: profile.email }
      : mobileNumber
        ? { phone: toAuthPhone(mobileNumber) }
        : null
    if (!identifier) {
      return {
        success: false,
        errorCode: 'PASSWORD_CURRENT_INVALID',
        message: 'Your current password is incorrect.',
      }
    }
    const { error: verifyError } = await verifyClient.auth.signInWithPassword({
      ...identifier,
      password: input.currentPassword,
    })

    if (verifyError) {
      return {
        success: false,
        errorCode: 'PASSWORD_CURRENT_INVALID',
        message: 'Your current password is incorrect.',
      }
    }

    // Best effort: revoke the throwaway session the verification just minted. Scope must stay
    // 'local' — the default 'global' scope revokes every session the user has, including the
    // cookie session this action is about to update.
    await verifyClient.auth.signOut({ scope: 'local' })

    const supabase = await createClient()
    const { error: updateError } = await supabase.auth.updateUser({
      password: validation.values.password,
    })

    if (updateError) {
      logger.error('settings/changeOwnPassword/updateUser', updateError, { userId: profile.id })
      return {
        success: false,
        errorCode: updateError.code ?? 'PASSWORD_CHANGE_UPDATE_FAILED',
        message: updateError.message,
      }
    }

    return { success: true }
  } catch (error) {
    // `input` carries the user's credentials — log the error alone, never the input.
    logger.error('settings/changeOwnPassword/unexpected', error)
    return {
      success: false,
      errorCode: 'PASSWORD_CHANGE_FAILED',
      message: 'Unable to change your password right now.',
    }
  }
}
