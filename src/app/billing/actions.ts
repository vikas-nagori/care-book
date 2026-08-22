'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/auth'
import type { OutstandingCharge } from '@/lib/billing/allocation-preview'
import { callBillingRpc, validateBillingEntry, validateReasonedMutation, validateRecordPayment, type ReasonedInput, type ReasonedKind, type RpcResult } from '@/lib/billing/mutations'
import { logger } from '@/lib/logger'
import { createClient } from '@/lib/supabase/server'
import type { BillingMutationResult, CreateBillingEntryInput, CreateBillingEntryResult, RecordPaymentInput, RecordPaymentResult, RefundInput } from '@/lib/supabase/types'

function revalidateBillingViews(patientId?: string) {
  revalidatePath('/billing'); revalidatePath('/schedule'); revalidatePath('/')
  if (patientId) revalidatePath(`/patients/${patientId}`)
}

function rpcError(result: RpcResult, fallback: string) {
  return { success: false as const, errorCode: result?.errorCode ?? 'BILLING_MUTATION_FAILED', message: result?.errorCode === '40001' ? 'Billing changed at the same time. Nothing was duplicated; please try again.' : result?.message ?? fallback }
}

async function requireBillingAdmin() {
  const profile = await getCurrentProfile()
  return Boolean(profile && profile.role === 'admin')
}

async function callRpc(name: string, params: Record<string, unknown>, context: Record<string, unknown>): Promise<RpcResult> {
  return callBillingRpc(await createClient(), name, params, context)
}

export async function recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  if (!(await requireBillingAdmin())) return { success: false, errorCode: 'PAYMENT_UNAUTHORIZED', message: 'You are not allowed to record payments.' }
  const validated = validateRecordPayment(input)
  if (!validated.ok) return { success: false, errorCode: validated.errorCode, message: validated.message }
  const result = await callRpc(validated.rpc, validated.params, { patientId: input.patientId, fundingScope: 'ordinary' })
  if (!result?.success || !result.paymentId) return rpcError(result, 'Unable to record this payment right now.')
  revalidateBillingViews(input.patientId)
  return { success: true, paymentId: result.paymentId, linkedAppointmentIds: result.linkedAppointmentIds ?? [], updatedPackageId: result.updatedPackageId ?? null }
}

export async function createBillingEntry(input: CreateBillingEntryInput): Promise<CreateBillingEntryResult> {
  if (!(await requireBillingAdmin())) return { success: false, errorCode: 'BILLING_UNAUTHORIZED', message: 'You are not allowed to manage billing.' }
  const validated = validateBillingEntry(input)
  if (!validated.ok) return { success: false, errorCode: validated.errorCode, message: validated.message, packageId: null }
  const result = await callRpc(validated.rpc, validated.params, { patientId: input.patientId, mode: input.mode })
  if (!result?.success) return { ...rpcError(result, 'Unable to save this billing entry right now.'), packageId: result?.packageId ?? null }
  revalidateBillingViews(input.patientId)
  return { success: true, packageId: result.packageId ?? null, paymentId: result.paymentId ?? null, linkedAppointmentIds: result.linkedAppointmentIds ?? [], remainingCredit: Number(result.remainingCredit ?? 0) }
}

async function reasonedMutation(kind: ReasonedKind, input: ReasonedInput, fallback: string): Promise<BillingMutationResult> {
  if (!(await requireBillingAdmin())) return { success: false, errorCode: 'BILLING_UNAUTHORIZED', message: 'You are not allowed to change billing records.' }
  const validated = validateReasonedMutation(kind, input)
  if (!validated.ok) return { success: false, errorCode: validated.errorCode, message: validated.message }
  const result = await callRpc(validated.rpc, validated.params, validated.params)
  if (!result?.success || !result.patientId) return rpcError(result, fallback)
  revalidateBillingViews(result.patientId)
  return { success: true, patientId: result.patientId, entityId: result.paymentId ?? result.packageId ?? result.refundId ?? result.refundReversalId ?? result.adjustmentId ?? result.appointmentId }
}

export async function voidPayment(paymentId: string, reason: string) { return await reasonedMutation('void_payment', { entityId: paymentId, reason }, 'Unable to void this payment.') }
export async function cancelPackage(packageId: string, reason: string) { return await reasonedMutation('cancel_package', { entityId: packageId, reason }, 'Unable to cancel this package.') }
export async function recordRefund(input: RefundInput) {
  return await reasonedMutation('record_refund', { entityId: input.paymentId, amount: input.amount, refundMethod: input.refundMethod, refundDate: input.refundDate, reason: input.reason }, 'Unable to record this refund.')
}
export async function voidRefund(refundId: string, reason: string) { return await reasonedMutation('void_refund', { entityId: refundId, reason }, 'Unable to reverse this refund.') }
export async function adjustAppointmentFee(appointmentId: string, adjustedAmount: number, reason: string) { return await reasonedMutation('adjust_appointment_fee', { entityId: appointmentId, adjustedAmount, reason }, 'Unable to adjust this appointment fee.') }

export async function reconcilePatientBilling(patientId: string) {
  if (!(await requireBillingAdmin())) return { success: false as const, errorCode: 'BILLING_UNAUTHORIZED', message: 'You are not allowed to reconcile billing.' }
  const result = await callRpc('reconcile_patient_billing_v2', { p_patient_id: patientId }, { patientId })
  if (!result?.success || !result.patientId) return rpcError(result, 'Unable to reconcile billing.')
  revalidateBillingViews(patientId)
  return { success: true as const, patientId }
}

/**
 * The regular-funded charges a new receipt could still draw on, in the order the v2 reconciler
 * walks them. Feeds the allocation preview in the billing entry form.
 *
 * Eligibility mirrors the ordinary branch of `private.reconcile_patient_billing_v2`: pending or
 * posted charges with a positive amount, minus what payments already cover, minus anything a
 * package has claimed (package sessions are funded by package money, never by a regular receipt).
 */
export async function getOutstandingCharges(patientId: string): Promise<{ success: true; charges: OutstandingCharge[] } | { success: false; message: string }> {
  if (!(await requireBillingAdmin())) return { success: false, message: 'You are not allowed to preview billing.' }
  if (!patientId) return { success: true, charges: [] }

  const supabase = await createClient()
  const [{ data: chargeRows, error: chargesError }, { data: applicationRows, error: applicationsError }, { data: packageRows, error: packagesError }] = await Promise.all([
    supabase
      .from('appointment_charges')
      .select('id, amount, appointment_id, appointment:appointments(date, time, type)')
      .eq('patient_id', patientId)
      .in('status', ['pending', 'posted'])
      .gt('amount', 0),
    supabase.from('payment_applications').select('charge_id, amount').eq('patient_id', patientId).eq('status', 'active'),
    supabase.from('package_session_allocations').select('appointment_id').eq('patient_id', patientId).neq('lifecycle', 'released'),
  ])

  if (chargesError || applicationsError || packagesError) {
    logger.error('billing/getOutstandingCharges', chargesError ?? applicationsError ?? packagesError, { patientId })
    return { success: false, message: 'Could not work out which sessions this payment would settle.' }
  }

  const appliedByCharge = new Map<string, number>()
  for (const row of applicationRows ?? []) {
    appliedByCharge.set(row.charge_id, (appliedByCharge.get(row.charge_id) ?? 0) + Number(row.amount ?? 0))
  }
  const packageClaimed = new Set((packageRows ?? []).map((row) => row.appointment_id))

  const charges = (chargeRows ?? []).flatMap((row) => {
    const appointment = Array.isArray(row.appointment) ? row.appointment[0] : row.appointment
    if (!row.appointment_id || !appointment || packageClaimed.has(row.appointment_id)) return []

    const chargeAmount = Number(row.amount ?? 0)
    const remainingAmount = Math.max(0, chargeAmount - (appliedByCharge.get(row.id) ?? 0))
    if (remainingAmount <= 0) return []

    return [{
      appointmentId: row.appointment_id,
      date: appointment.date,
      time: appointment.time ?? '00:00:00',
      type: appointment.type ?? 'Session',
      chargeAmount,
      remainingAmount,
    }]
  })

  return { success: true, charges }
}

export async function previewBillingAllocation(patientId: string) {
  if (!(await requireBillingAdmin())) return { success: false as const, errorCode: 'BILLING_UNAUTHORIZED', message: 'You are not allowed to preview billing.' }
  const result = await callRpc('preview_billing_allocation_v2', { p_patient_id: patientId }, { patientId })
  return result?.success ? result : rpcError(result, 'Unable to preview billing.')
}
