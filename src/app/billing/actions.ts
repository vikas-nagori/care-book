'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/auth'
import type { OutstandingCharge } from '@/lib/billing/allocation-preview'
import { calculatePackageTotal } from '@/lib/billing/payment-helpers'
import { logger } from '@/lib/logger'
import { createClient } from '@/lib/supabase/server'
import type { BillingMutationResult, CreateBillingEntryInput, CreateBillingEntryResult, RecordPaymentInput, RecordPaymentResult, RefundInput } from '@/lib/supabase/types'

type RpcResult = { success?: boolean; patientId?: string; paymentId?: string; packageId?: string; refundId?: string; refundReversalId?: string; adjustmentId?: string; appointmentId?: string; linkedAppointmentIds?: string[]; remainingCredit?: number; updatedPackageId?: string | null; errorCode?: string; message?: string; [key: string]: unknown } | null

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
  const supabase = await createClient()
  const { data, error } = await supabase.rpc(name, params)
  if (error) {
    logger.error(`billing/${name}`, error, context)
    return { success: false, errorCode: error.code ?? 'BILLING_MUTATION_FAILED', message: error.message }
  }
  return data as RpcResult
}

export async function recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  if (!(await requireBillingAdmin())) return { success: false, errorCode: 'PAYMENT_UNAUTHORIZED', message: 'You are not allowed to record payments.' }
  if (!input.patientId) return { success: false, errorCode: 'PAYMENT_MISSING_PATIENT', message: 'Choose a patient before recording a payment.' }
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { success: false, errorCode: 'PAYMENT_INVALID_AMOUNT', message: 'Payment amount must be greater than zero.' }
  // Server Actions are a public HTTP endpoint: a caller-supplied funding scope let an admin
  // POST `package` directly and book a partial receipt against a package, stranding a due no
  // screen can collect. Standalone receipts are ordinary-scoped, full stop — the RPC mirrors
  // this by rejecting a package-scoped payment that is not the full package total.
  const result = await callRpc('record_payment_v2', { p_patient_id: input.patientId, p_funding_scope: 'ordinary', p_package_id: null, p_amount: input.amount, p_payment_method: input.paymentMethod, p_payment_date: input.date, p_notes: input.notes }, { patientId: input.patientId, fundingScope: 'ordinary' })
  if (!result?.success || !result.paymentId) return rpcError(result, 'Unable to record this payment right now.')
  revalidateBillingViews(input.patientId)
  return { success: true, paymentId: result.paymentId, linkedAppointmentIds: result.linkedAppointmentIds ?? [], updatedPackageId: result.updatedPackageId ?? null }
}

export async function createBillingEntry(input: CreateBillingEntryInput): Promise<CreateBillingEntryResult> {
  if (!(await requireBillingAdmin())) return { success: false, errorCode: 'BILLING_UNAUTHORIZED', message: 'You are not allowed to manage billing.' }
  if (!input.patientId) return { success: false, errorCode: 'BILLING_MISSING_PATIENT', message: 'Choose a patient before saving billing details.' }
  if (input.mode === 'package_with_payment') {
    if (!input.packageName?.trim()) return { success: false, errorCode: 'PACKAGE_NAME_REQUIRED', message: 'Enter a package name.' }
    if (!Number.isInteger(input.packageTotalSessions) || Number(input.packageTotalSessions) <= 0) return { success: false, errorCode: 'PACKAGE_INVALID_SESSIONS', message: 'Total sessions must be greater than zero.' }
    if (!Number.isFinite(input.packagePerSessionAmount) || Number(input.packagePerSessionAmount) <= 0) return { success: false, errorCode: 'PACKAGE_INVALID_AMOUNT', message: 'Per-session charge must be greater than zero.' }
    if (!input.appointmentTypeId) return { success: false, errorCode: 'PACKAGE_APPOINTMENT_TYPE_REQUIRED', message: 'Choose the appointment type covered by this package.' }
    if (!input.packageStartsOn) return { success: false, errorCode: 'PACKAGE_START_DATE_REQUIRED', message: 'Choose a package start date.' }
    if (!input.paymentNotes?.trim()) return { success: false, errorCode: 'PACKAGE_NOTES_REQUIRED', message: 'Add notes for this package receipt.' }
  }
  const paymentAmount = Number(input.paymentAmount ?? 0)
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) return { success: false, errorCode: 'PAYMENT_INVALID_AMOUNT', message: 'Payment amount must be greater than zero.' }
  // Packages are prepaid in full. A partial receipt would strand a package due that no screen
  // can collect, so reject it here as well as in the RPC.
  if (input.mode === 'package_with_payment') {
    const packageTotal = calculatePackageTotal(Number(input.packageTotalSessions), Number(input.packagePerSessionAmount))
    if (Math.abs(paymentAmount - packageTotal) > 0.005) {
      return { success: false, errorCode: 'PACKAGE_PARTIAL_PAYMENT', message: 'A package is collected in full — the amount received must equal the package total.' }
    }
  }
  if (!input.paymentMethod) return { success: false, errorCode: 'PAYMENT_METHOD_REQUIRED', message: 'Choose a payment method.' }
  if (!input.paymentDate) return { success: false, errorCode: 'PAYMENT_DATE_REQUIRED', message: 'Choose a payment date.' }
  const result = await callRpc('record_billing_entry_v2', { p_patient_id: input.patientId, p_entry_kind: input.mode, p_package_name: input.packageName ?? null, p_package_total_sessions: input.packageTotalSessions ?? null, p_package_per_session_amount: input.packagePerSessionAmount ?? null, p_appointment_type_id: input.appointmentTypeId ?? null, p_package_starts_on: input.packageStartsOn ?? null, p_amount: paymentAmount, p_payment_method: input.paymentMethod, p_payment_date: input.paymentDate, p_notes: input.paymentNotes ?? null }, { patientId: input.patientId, mode: input.mode })
  if (!result?.success) return { ...rpcError(result, 'Unable to save this billing entry right now.'), packageId: result?.packageId ?? null }
  revalidateBillingViews(input.patientId)
  return { success: true, packageId: result.packageId ?? null, paymentId: result.paymentId ?? null, linkedAppointmentIds: result.linkedAppointmentIds ?? [], remainingCredit: Number(result.remainingCredit ?? 0) }
}

async function reasonedMutation(rpc: string, params: Record<string, unknown>, reason: string, fallback: string): Promise<BillingMutationResult> {
  if (!(await requireBillingAdmin())) return { success: false, errorCode: 'BILLING_UNAUTHORIZED', message: 'You are not allowed to change billing records.' }
  if (!reason.trim()) return { success: false, errorCode: 'BILLING_REASON_REQUIRED', message: 'A reason is required for this audited change.' }
  const result = await callRpc(rpc, params, params)
  if (!result?.success || !result.patientId) return rpcError(result, fallback)
  revalidateBillingViews(result.patientId)
  return { success: true, patientId: result.patientId, entityId: result.paymentId ?? result.packageId ?? result.refundId ?? result.refundReversalId ?? result.adjustmentId ?? result.appointmentId }
}

export async function voidPayment(paymentId: string, reason: string) { return await reasonedMutation('void_payment', { p_payment_id: paymentId, p_reason: reason.trim() }, reason, 'Unable to void this payment.') }
export async function cancelPackage(packageId: string, reason: string) { return await reasonedMutation('cancel_package', { p_package_id: packageId, p_reason: reason.trim() }, reason, 'Unable to cancel this package.') }
export async function recordRefund(input: RefundInput) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { success: false as const, errorCode: 'REFUND_INVALID_AMOUNT', message: 'Refund amount must be greater than zero.' }
  if (!input.refundMethod) return { success: false as const, errorCode: 'REFUND_METHOD_REQUIRED', message: 'Choose a refund method.' }
  if (!input.refundDate) return { success: false as const, errorCode: 'REFUND_DATE_REQUIRED', message: 'Choose a refund date.' }
  return await reasonedMutation('record_refund', { p_payment_id: input.paymentId, p_amount: input.amount, p_refund_method: input.refundMethod, p_refund_date: input.refundDate, p_reason: input.reason.trim() }, input.reason, 'Unable to record this refund.')
}
export async function voidRefund(refundId: string, reason: string) { return await reasonedMutation('void_refund', { p_refund_id: refundId, p_reason: reason.trim() }, reason, 'Unable to reverse this refund.') }
export async function adjustAppointmentFee(appointmentId: string, adjustedAmount: number, reason: string) { return await reasonedMutation('adjust_appointment_fee', { p_appointment_id: appointmentId, p_adjusted_amount: adjustedAmount, p_reason: reason.trim() }, reason, 'Unable to adjust this appointment fee.') }

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
