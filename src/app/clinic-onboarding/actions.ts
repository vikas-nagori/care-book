'use server'

import { headers } from 'next/headers'
import { logger } from '@/lib/logger'
import {
  buildClinicOnboardingFingerprint,
  getOnboardingThrottleWindowStart,
  ONBOARDING_MAX_PENDING_PER_FINGERPRINT,
  validateClinicOnboardingInput,
} from '@/lib/onboarding/clinic-onboarding-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  CreateClinicOnboardingRequestInput,
  CreateClinicOnboardingRequestResult,
} from '@/lib/supabase/types'

function getRequestIp(headerStore: Headers): string | null {
  const forwardedFor = headerStore.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || null
  }

  return headerStore.get('x-real-ip')
}

export async function createClinicOnboardingRequest(
  input: CreateClinicOnboardingRequestInput
): Promise<CreateClinicOnboardingRequestResult> {
  try {
    const validation = validateClinicOnboardingInput(input)
    if (!validation.success) {
      return {
        success: false,
        errorCode: validation.errorCode,
        message: validation.message,
      }
    }

    const adminSupabase = createAdminClient()
    const headerStore = await headers()
    const requestIp = getRequestIp(headerStore)
    const requestUserAgent = headerStore.get('user-agent')
    const requestFingerprint = buildClinicOnboardingFingerprint({
      clinicName: validation.values.clinicName,
      ownerEmail: validation.values.ownerEmail,
      ownerMobileNumber: validation.values.ownerMobileNumber,
      requestIp,
    })

    const [
      { data: duplicateEmailPending, error: duplicateEmailLookupError },
      { data: duplicateClinicPending, error: duplicateClinicLookupError },
    ] = await Promise.all([
      adminSupabase
        .from('clinic_onboarding_requests')
        .select('id')
        .eq('status', 'pending')
        .eq('owner_email', validation.values.ownerEmail)
        .limit(1)
        .maybeSingle(),
      adminSupabase
        .from('clinic_onboarding_requests')
        .select('id')
        .eq('status', 'pending')
        .eq('clinic_name', validation.values.clinicName)
        .limit(1)
        .maybeSingle(),
    ])
    const duplicateLookupError = duplicateEmailLookupError ?? duplicateClinicLookupError

    if (duplicateLookupError) {
      logger.error('clinicOnboarding/createRequest/duplicateLookup', duplicateLookupError, {
        ownerEmail: validation.values.ownerEmail,
        clinicName: validation.values.clinicName,
      })
      return {
        success: false,
        errorCode: duplicateLookupError.code ?? 'CLINIC_ONBOARDING_LOOKUP_FAILED',
        message: 'Unable to submit the onboarding request right now.',
      }
    }

    if (duplicateEmailPending || duplicateClinicPending) {
      return {
        success: false,
        errorCode: 'CLINIC_ONBOARDING_ALREADY_PENDING',
        message: 'A pending onboarding request already exists for these details.',
      }
    }

    const { count: recentCount, error: throttleLookupError } = await adminSupabase
      .from('clinic_onboarding_requests')
      .select('id', { count: 'exact', head: true })
      .eq('request_fingerprint', requestFingerprint)
      .gte('created_at', getOnboardingThrottleWindowStart())

    if (throttleLookupError) {
      logger.error('clinicOnboarding/createRequest/throttleLookup', throttleLookupError, {
        requestFingerprint,
      })
      return {
        success: false,
        errorCode: throttleLookupError.code ?? 'CLINIC_ONBOARDING_LOOKUP_FAILED',
        message: 'Unable to submit the onboarding request right now.',
      }
    }

    if ((recentCount ?? 0) >= ONBOARDING_MAX_PENDING_PER_FINGERPRINT) {
      return {
        success: false,
        errorCode: 'CLINIC_ONBOARDING_RATE_LIMITED',
        message: 'Too many onboarding requests were submitted recently. Try again later.',
      }
    }

    const { data, error } = await adminSupabase
      .from('clinic_onboarding_requests')
      .insert({
        clinic_name: validation.values.clinicName,
        owner_full_name: validation.values.ownerFullName,
        owner_email: validation.values.ownerEmail,
        owner_mobile_number: validation.values.ownerMobileNumber,
        clinic_phone: validation.values.clinicPhone,
        clinic_address: validation.values.clinicAddress,
        request_ip: requestIp,
        request_user_agent: requestUserAgent,
        request_fingerprint: requestFingerprint,
        status: 'pending',
      })
      .select('id')
      .single()

    if (error || !data) {
      logger.error('clinicOnboarding/createRequest', error, validation.values)
      return {
        success: false,
        errorCode: error?.code ?? 'CLINIC_ONBOARDING_CREATE_FAILED',
        message: error?.message ?? 'Unable to submit the onboarding request right now.',
      }
    }

    return {
      success: true,
      requestId: data.id,
    }
  } catch (error) {
    logger.error('clinicOnboarding/createRequest/unexpected', error, input)
    return {
      success: false,
      errorCode: 'CLINIC_ONBOARDING_CREATE_FAILED',
      message: 'Unable to submit the onboarding request right now.',
    }
  }
}
