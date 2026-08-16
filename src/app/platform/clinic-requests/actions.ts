'use server'

import { revalidatePath } from 'next/cache'
import {
  buildInviteRedirectTo,
  getInviteErrorMessage,
  syncInvitedProfile,
} from '@/lib/onboarding/invite-server'
import { normalizeEmail } from '@/lib/onboarding/invite-helpers'
import { requirePlatformAdminUser } from '@/lib/platform/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type {
  ManageClinicOnboardingRequestInput,
  ManageClinicOnboardingRequestResult,
  ClinicOnboardingRequest,
} from '@/lib/supabase/types'

export async function approveClinicOnboardingRequest(
  input: ManageClinicOnboardingRequestInput
): Promise<ManageClinicOnboardingRequestResult> {
  try {
    const platformUser = await requirePlatformAdminUser()
    if (!input.requestId) {
      return {
        success: false,
        errorCode: 'CLINIC_REQUEST_ID_REQUIRED',
        message: 'Choose an onboarding request.',
      }
    }

    const adminSupabase = createAdminClient()
    const { data: request, error: requestError } = await adminSupabase
      .from('clinic_onboarding_requests')
      .select('*')
      .eq('id', input.requestId)
      .eq('status', 'pending')
      .maybeSingle()

    if (requestError || !request) {
      logger.error('platform/approveClinicOnboardingRequest/lookup', requestError, input)
      return {
        success: false,
        errorCode: requestError?.code ?? 'CLINIC_REQUEST_NOT_FOUND',
        message: 'Pending onboarding request was not found.',
      }
    }

    const normalizedOwnerEmail = normalizeEmail(request.owner_email)
    const { data: clinic, error: clinicError } = await adminSupabase
      .from('clinics')
      .insert({
        name: request.clinic_name.trim(),
        phone: request.clinic_phone?.trim() || null,
        address: request.clinic_address?.trim() || null,
        status: 'active',
      })
      .select('id')
      .single()

    if (clinicError || !clinic) {
      logger.error('platform/approveClinicOnboardingRequest/createClinic', clinicError, {
        requestId: request.id,
      })
      return {
        success: false,
        errorCode: clinicError?.code ?? 'CLINIC_CREATE_FAILED',
        message: clinicError?.message ?? 'Unable to create the clinic.',
      }
    }

    const { error: settingsError } = await adminSupabase
      .from('global_settings')
      .insert({ clinic_id: clinic.id })

    if (settingsError) {
      logger.error('platform/approveClinicOnboardingRequest/createSettings', settingsError, {
        requestId: request.id,
        clinicId: clinic.id,
      })
      return {
        success: false,
        errorCode: settingsError.code ?? 'CLINIC_SETTINGS_CREATE_FAILED',
        message: settingsError.message,
      }
    }

    const redirectTo = await buildInviteRedirectTo()
    const { data: inviteUserData, error: inviteUserError } =
      await adminSupabase.auth.admin.inviteUserByEmail(normalizedOwnerEmail, {
        redirectTo,
        data: { role: 'admin', clinic_id: clinic.id },
      })

    if (inviteUserError) {
      logger.error('platform/approveClinicOnboardingRequest/inviteOwner', inviteUserError, {
        requestId: request.id,
        clinicId: clinic.id,
      })
      return {
        success: false,
        errorCode: inviteUserError.code ?? 'CLINIC_OWNER_INVITE_FAILED',
        message: getInviteErrorMessage(inviteUserError),
      }
    }

    // The auth user now exists, so the on_auth_user_created trigger has already written an
    // unprivileged placeholder profile (role 'staff', no clinic). Promote it to the owner the
    // approval actually granted, so the platform console and any pre-acceptance sign-in see
    // the real role and clinic rather than the placeholder.
    const ownerAuthUserId = inviteUserData.user?.id
    if (ownerAuthUserId) {
      const { error: profileSyncError } = await syncInvitedProfile(adminSupabase, {
        authUserId: ownerAuthUserId,
        clinicId: clinic.id,
        email: normalizedOwnerEmail,
        role: 'admin',
      })

      if (profileSyncError) {
        logger.error('platform/approveClinicOnboardingRequest/syncOwnerProfile', profileSyncError, {
          requestId: request.id,
          clinicId: clinic.id,
        })
        return {
          success: false,
          errorCode: profileSyncError.code ?? 'CLINIC_OWNER_PROFILE_SYNC_FAILED',
          message: 'The owner was invited, but saving their admin profile failed.',
        }
      }
    }

    const now = new Date().toISOString()
    const { error: inviteError } = await adminSupabase
      .from('user_invites')
      .insert({
        clinic_id: clinic.id,
        email: normalizedOwnerEmail,
        role: 'admin',
        status: 'pending',
        auth_user_id: inviteUserData.user?.id ?? null,
        invited_by: platformUser.id,
        accepted_at: null,
        revoked_at: null,
        updated_at: now,
      })

    if (inviteError) {
      logger.error('platform/approveClinicOnboardingRequest/saveInvite', inviteError, {
        requestId: request.id,
        clinicId: clinic.id,
      })
      return {
        success: false,
        errorCode: inviteError.code ?? 'CLINIC_OWNER_INVITE_SAVE_FAILED',
        message: inviteError.message,
      }
    }

    const { data: updatedRequest, error: updateError } = await adminSupabase
      .from('clinic_onboarding_requests')
      .update({
        status: 'approved',
        approved_by: platformUser.id,
        approved_at: now,
        clinic_id: clinic.id,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
        updated_at: now,
      })
      .eq('id', request.id)
      .select('*')
      .single()

    if (updateError || !updatedRequest) {
      logger.error('platform/approveClinicOnboardingRequest/updateRequest', updateError, {
        requestId: request.id,
        clinicId: clinic.id,
      })
      return {
        success: false,
        errorCode: updateError?.code ?? 'CLINIC_REQUEST_APPROVE_FAILED',
        message: updateError?.message ?? 'Clinic was created, but the request could not be marked approved.',
      }
    }

    revalidatePath('/platform/clinic-requests')
    return {
      success: true,
      request: updatedRequest as ClinicOnboardingRequest,
    }
  } catch (error) {
    logger.error('platform/approveClinicOnboardingRequest/unexpected', error, input)
    return {
      success: false,
      errorCode: 'CLINIC_REQUEST_APPROVE_FAILED',
      message: 'Unable to approve this request right now.',
    }
  }
}

export async function rejectClinicOnboardingRequest(
  input: ManageClinicOnboardingRequestInput
): Promise<ManageClinicOnboardingRequestResult> {
  try {
    const platformUser = await requirePlatformAdminUser()
    if (!input.requestId) {
      return {
        success: false,
        errorCode: 'CLINIC_REQUEST_ID_REQUIRED',
        message: 'Choose an onboarding request.',
      }
    }

    const now = new Date().toISOString()
    const adminSupabase = createAdminClient()
    const { data, error } = await adminSupabase
      .from('clinic_onboarding_requests')
      .update({
        status: 'rejected',
        rejected_by: platformUser.id,
        rejected_at: now,
        rejection_reason: input.rejectionReason?.trim() || null,
        updated_at: now,
      })
      .eq('id', input.requestId)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle()

    if (error || !data) {
      logger.error('platform/rejectClinicOnboardingRequest/update', error, input)
      return {
        success: false,
        errorCode: error?.code ?? 'CLINIC_REQUEST_REJECT_FAILED',
        message: error?.message ?? 'Pending onboarding request was not found.',
      }
    }

    revalidatePath('/platform/clinic-requests')
    return {
      success: true,
      request: data as ClinicOnboardingRequest,
    }
  } catch (error) {
    logger.error('platform/rejectClinicOnboardingRequest/unexpected', error, input)
    return {
      success: false,
      errorCode: 'CLINIC_REQUEST_REJECT_FAILED',
      message: 'Unable to reject this request right now.',
    }
  }
}
