'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/auth'
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
    // Every child FK to patients is ON DELETE CASCADE, so this single delete
    // removes appointments, treatment plans, packages, payments, session notes,
    // and their billing junction rows for this patient.
    const { error } = await supabase
      .from('patients')
      .delete()
      .eq('id', patientId)
      .eq('clinic_id', profile.clinic_id)

    if (error) {
      logger.error('patients/deletePatient', error, { patientId })
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
