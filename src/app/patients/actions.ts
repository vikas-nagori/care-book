'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/auth'
import { evaluateRoleAccess } from '@/lib/auth-access'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

export interface DeletePatientResult {
  success: boolean
  errorCode?: string
  message?: string
}

export async function deletePatient(patientId: string): Promise<DeletePatientResult> {
  try {
    const profile = await getCurrentProfile()
    if (!profile || profile.role !== 'admin' || !profile.clinic_id) {
      return {
        success: false,
        errorCode: 'PATIENT_DELETE_UNAUTHORIZED',
        message: 'Only admins can delete patients.',
      }
    }

    if (!patientId) {
      return {
        success: false,
        errorCode: 'PATIENT_DELETE_MISSING_ID',
        message: 'Choose a patient to delete.',
      }
    }

    const supabase = await createClient()
    // Empty patient records may be removed. Billing-ledger foreign keys deliberately
    // reject deletion once audit history exists so actor and patient references remain intact.
    const { error } = await supabase
      .from('patients')
      .delete()
      .eq('id', patientId)
      .eq('clinic_id', profile.clinic_id)

    if (error) {
      logger.error('patients/deletePatient', error, { patientId })
      if (error.code === '23503') {
        return {
          success: false,
          errorCode: 'PATIENT_DELETE_AUDIT_HISTORY',
          message: 'Patients with billing history cannot be deleted because their audit trail must be retained.',
        }
      }
      return {
        success: false,
        errorCode: error.code ?? 'PATIENT_DELETE_FAILED',
        message: 'Could not delete patient. Please try again.',
      }
    }

    revalidatePath('/patients')
    revalidatePath('/schedule')
    revalidatePath('/billing')
    revalidatePath('/')
    return { success: true }
  } catch (error) {
    logger.error('patients/deletePatient/unexpected', error, { patientId })
    return {
      success: false,
      errorCode: 'PATIENT_DELETE_FAILED',
      message: 'Could not delete patient. Please try again.',
    }
  }
}

export async function savePatientExternalAccess(patientId: string, profileIds: string[]) {
  const saveError = { success: false, message: 'Unable to save patient access. Please try again.' } as const
  try {
    const profile = await getCurrentProfile()
    if (!profile?.clinic_id || evaluateRoleAccess(profile, ['admin']) !== 'authorized') {
      return { success: false, message: 'Only admins can manage External Staff access.' } as const
    }

    const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
    if (typeof patientId !== 'string' || !uuid.test(patientId) || !Array.isArray(profileIds) ||
      !profileIds.every((id) => typeof id === 'string' && uuid.test(id))) {
      return { success: false, message: 'Check the selected accounts and try again.' } as const
    }

    const supabase = await createClient()
    const { error } = await supabase.rpc('replace_patient_external_access', {
      p_patient_id: patientId,
      p_profile_ids: [...new Set(profileIds.map((id) => id.toLowerCase()))],
    })
    if (error) {
      logger.error('patients/savePatientExternalAccess', error, { patientId })
      return error.code === '22023'
        ? { success: false, message: 'Choose active External Staff from this clinic.' } as const
        : saveError
    }

    try {
      revalidatePath(`/patients/${patientId}`)
    } catch (error) {
      logger.error('patients/savePatientExternalAccess/revalidate', error, { patientId })
    }
    return { success: true } as const
  } catch (error) {
    logger.error('patients/savePatientExternalAccess/unexpected', error)
    return saveError
  }
}
