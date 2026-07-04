'use server'

import { logger } from '@/lib/logger'
import { validateClinicOnboardingInput } from '@/lib/onboarding/clinic-onboarding-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  CreateClinicOnboardingRequestInput,
  CreateClinicOnboardingRequestResult,
} from '@/lib/supabase/types'

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
    const { data, error } = await adminSupabase
      .from('clinic_onboarding_requests')
      .insert({
        clinic_name: validation.values.clinicName,
        owner_full_name: validation.values.ownerFullName,
        owner_email: validation.values.ownerEmail,
        owner_mobile_number: validation.values.ownerMobileNumber,
        clinic_phone: validation.values.clinicPhone,
        clinic_address: validation.values.clinicAddress,
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
