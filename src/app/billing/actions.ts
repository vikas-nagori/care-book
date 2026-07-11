'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { createClient } from '@/lib/supabase/server'
import type {
  CreateBillingEntryInput,
  CreateBillingEntryResult,
  RecordPaymentInput,
  RecordPaymentResult,
} from '@/lib/supabase/types'

type RpcRecordPaymentResult = {
  success?: boolean
  paymentId?: string
  linkedAppointmentIds?: string[]
  updatedPackageId?: string | null
  errorCode?: string
  message?: string
} | null

type RpcRecordBillingEntryResult = {
  success?: boolean
  packageId?: string | null
  paymentId?: string | null
  linkedAppointmentIds?: string[]
  remainingCredit?: number
  errorCode?: string
  message?: string
} | null

async function callRecordPaymentRpc(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('record_payment', {
    p_patient_id: input.patientId,
    p_package_id: input.packageId,
    p_amount: input.amount,
    p_payment_method: input.paymentMethod,
    p_payment_date: input.date,
    p_notes: input.notes,
  })

  if (error) {
    logger.error('billing/recordPayment/rpc', error, {
      patientId: input.patientId,
      packageId: input.packageId,
    })
    return {
      success: false,
      errorCode: error.code ?? 'PAYMENT_RECORD_FAILED',
      message: error.message,
    }
  }

  const result = data as RpcRecordPaymentResult

  if (!result?.success || !result.paymentId) {
    return {
      success: false,
      errorCode: result?.errorCode ?? 'PAYMENT_RECORD_FAILED',
      message: result?.message ?? 'Unable to record this payment right now.',
    }
  }

  return {
    success: true,
    paymentId: result.paymentId,
    linkedAppointmentIds: result.linkedAppointmentIds ?? [],
    updatedPackageId: result.updatedPackageId ?? null,
  }
}

function revalidateBillingViews() {
  revalidatePath('/billing')
  revalidatePath('/schedule')
  revalidatePath('/')
}

export async function recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  try {
    const profile = await getCurrentProfile()
    if (!profile || profile.role !== 'admin') {
      return {
        success: false,
        errorCode: 'PAYMENT_UNAUTHORIZED',
        message: 'You are not allowed to record payments.',
      }
    }

    if (!input.patientId) {
      return {
        success: false,
        errorCode: 'PAYMENT_MISSING_PATIENT',
        message: 'Choose a patient before recording a payment.',
      }
    }

    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return {
        success: false,
        errorCode: 'PAYMENT_INVALID_AMOUNT',
        message: 'Payment amount must be greater than zero.',
      }
    }
    const result = await callRecordPaymentRpc(input)
    if (!result.success) {
      return result
    }

    revalidateBillingViews()
    return result
  } catch (error) {
    logger.error('billing/recordPayment/unexpected', error, {
      patientId: input.patientId,
      packageId: input.packageId,
    })
    return {
      success: false,
      errorCode: 'PAYMENT_RECORD_FAILED',
      message: 'Unable to record this payment right now.',
    }
  }
}

export async function createBillingEntry(
  input: CreateBillingEntryInput,
): Promise<CreateBillingEntryResult> {
  try {
    const profile = await getCurrentProfile()
    if (!profile || profile.role !== 'admin') {
      return {
        success: false,
        errorCode: 'BILLING_UNAUTHORIZED',
        message: 'You are not allowed to manage billing.',
      }
    }

    if (!input.patientId) {
      return {
        success: false,
        errorCode: 'BILLING_MISSING_PATIENT',
        message: 'Choose a patient before saving billing details.',
      }
    }

    if (input.mode === 'package_with_payment') {
      if (!input.packageName?.trim()) {
        return {
          success: false,
          errorCode: 'PACKAGE_NAME_REQUIRED',
          message: 'Enter a package name.',
        }
      }

      if (!Number.isInteger(input.packageTotalSessions) || Number(input.packageTotalSessions) <= 0) {
        return {
          success: false,
          errorCode: 'PACKAGE_INVALID_SESSIONS',
          message: 'Total sessions must be greater than zero.',
        }
      }

      if (!Number.isFinite(input.packagePerSessionAmount) || Number(input.packagePerSessionAmount) < 0) {
        return {
          success: false,
          errorCode: 'PACKAGE_INVALID_AMOUNT',
          message: 'Per-session charge cannot be negative.',
        }
      }
    }

    const paymentAmount = input.paymentAmount ?? 0

    // Packages are prepaid-only, so both entry types always require a positive payment amount.
    if (!Number.isFinite(paymentAmount) || Number(paymentAmount) <= 0) {
      return {
        success: false,
        errorCode: 'PAYMENT_INVALID_AMOUNT',
        message:
          input.mode === 'package_with_payment'
            ? 'Enter the amount collected for this package.'
            : 'Payment amount must be greater than zero.',
      }
    }

    if (!input.paymentMethod) {
      return {
        success: false,
        errorCode: 'PAYMENT_METHOD_REQUIRED',
        message: 'Choose a payment method.',
      }
    }

    if (!input.paymentDate) {
      return {
        success: false,
        errorCode: 'PAYMENT_DATE_REQUIRED',
        message: 'Choose a payment date.',
      }
    }

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('record_billing_entry', {
      p_patient_id: input.patientId,
      p_entry_kind: input.mode,
      p_package_name: input.packageName ?? null,
      p_package_total_sessions: input.packageTotalSessions ?? null,
      p_package_per_session_amount: input.packagePerSessionAmount ?? null,
      p_package_payment_timing: 'prepaid',
      p_amount: paymentAmount,
      p_payment_method: input.paymentMethod ?? null,
      p_payment_date: input.paymentDate ?? null,
      p_notes: input.paymentNotes ?? null,
    })

    if (error) {
      logger.error('billing/createBillingEntry/rpc', error, {
        patientId: input.patientId,
        mode: input.mode,
      })
      return {
        success: false,
        errorCode: error.code ?? 'BILLING_SAVE_FAILED',
        message: error.message,
      }
    }

    const result = data as RpcRecordBillingEntryResult

    if (!result?.success) {
      return {
        success: false,
        errorCode: result?.errorCode ?? 'BILLING_SAVE_FAILED',
        message: result?.message ?? 'Unable to save this billing entry right now.',
        packageId: result?.packageId ?? null,
      }
    }

    revalidateBillingViews()
    return {
      success: true,
      packageId: result.packageId ?? null,
      paymentId: result.paymentId ?? null,
      linkedAppointmentIds: result.linkedAppointmentIds ?? [],
      remainingCredit: Number(result.remainingCredit ?? 0),
    }
  } catch (error) {
    logger.error('billing/createBillingEntry/unexpected', error, {
      patientId: input.patientId,
      mode: input.mode,
    })
    return {
      success: false,
      errorCode: 'BILLING_SAVE_FAILED',
      message: 'Unable to save this billing entry right now.',
    }
  }
}
