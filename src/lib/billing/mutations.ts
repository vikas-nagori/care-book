import type { SupabaseClient } from '@supabase/supabase-js'
import { calculatePackageTotal } from './payment-helpers.ts'
import type { BillingEntryKind, CreateBillingEntryInput, RecordPaymentInput } from '../supabase/types.ts'
import { logger } from '../logger.ts'

export type RpcResult = {
  success?: boolean
  patientId?: string
  paymentId?: string
  packageId?: string
  refundId?: string
  refundReversalId?: string
  adjustmentId?: string
  appointmentId?: string
  linkedAppointmentIds?: string[]
  remainingCredit?: number
  updatedPackageId?: string | null
  errorCode?: string
  message?: string
  [key: string]: unknown
} | null

export type ValidationFailure = { ok: false; errorCode: string; message: string }
export type ValidationSuccess<T> = { ok: true; rpc: string; params: Record<string, unknown>; summary: T }
export type Validated<T> = ValidationSuccess<T> | ValidationFailure

export type PaymentSummary = { patientId: string; amount: number; method: string; date: string }
export type EntrySummary = {
  patientId: string
  mode: BillingEntryKind
  packageName: string | null
  totalSessions: number | null
  packageTotal: number | null
  amount: number
  method: string
  date: string
}
export type ReasonedKind = 'void_payment' | 'cancel_package' | 'record_refund' | 'void_refund' | 'adjust_appointment_fee'
export type ReasonedInput = {
  entityId: string
  reason: string
  amount?: number
  refundMethod?: string
  refundDate?: string
  adjustedAmount?: number
}
export type ReasonedSummary = { kind: ReasonedKind; entityId: string; reason: string; amount: number | null }

export function validateRecordPayment(input: RecordPaymentInput): Validated<PaymentSummary> {
  if (!input.patientId) return { ok: false, errorCode: 'PAYMENT_MISSING_PATIENT', message: 'Choose a patient before recording a payment.' }
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { ok: false, errorCode: 'PAYMENT_INVALID_AMOUNT', message: 'Payment amount must be greater than zero.' }
  return {
    ok: true,
    rpc: 'record_payment_v2',
    params: {
      p_patient_id: input.patientId,
      p_funding_scope: 'ordinary',
      p_package_id: null,
      p_amount: input.amount,
      p_payment_method: input.paymentMethod,
      p_payment_date: input.date,
      p_notes: input.notes,
    },
    summary: { patientId: input.patientId, amount: input.amount, method: input.paymentMethod, date: input.date },
  }
}

export function validateBillingEntry(input: CreateBillingEntryInput): Validated<EntrySummary> {
  if (!input.patientId) return { ok: false, errorCode: 'BILLING_MISSING_PATIENT', message: 'Choose a patient before saving billing details.' }
  if (input.mode === 'package_with_payment') {
    if (!input.packageName?.trim()) return { ok: false, errorCode: 'PACKAGE_NAME_REQUIRED', message: 'Enter a package name.' }
    if (!Number.isInteger(input.packageTotalSessions) || Number(input.packageTotalSessions) <= 0) return { ok: false, errorCode: 'PACKAGE_INVALID_SESSIONS', message: 'Total sessions must be greater than zero.' }
    if (!Number.isFinite(input.packagePerSessionAmount) || Number(input.packagePerSessionAmount) <= 0) return { ok: false, errorCode: 'PACKAGE_INVALID_AMOUNT', message: 'Per-session charge must be greater than zero.' }
    if (!input.appointmentTypeId) return { ok: false, errorCode: 'PACKAGE_APPOINTMENT_TYPE_REQUIRED', message: 'Choose the appointment type covered by this package.' }
    if (!input.packageStartsOn) return { ok: false, errorCode: 'PACKAGE_START_DATE_REQUIRED', message: 'Choose a package start date.' }
    if (!input.paymentNotes?.trim()) return { ok: false, errorCode: 'PACKAGE_NOTES_REQUIRED', message: 'Add notes for this package receipt.' }
  }
  const paymentAmount = Number(input.paymentAmount ?? 0)
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) return { ok: false, errorCode: 'PAYMENT_INVALID_AMOUNT', message: 'Payment amount must be greater than zero.' }
  const packageTotal = input.mode === 'package_with_payment'
    ? calculatePackageTotal(Number(input.packageTotalSessions), Number(input.packagePerSessionAmount))
    : null
  if (packageTotal !== null && Math.abs(paymentAmount - packageTotal) > 0.005) return { ok: false, errorCode: 'PACKAGE_PARTIAL_PAYMENT', message: 'A package is collected in full — the amount received must equal the package total.' }
  if (!input.paymentMethod) return { ok: false, errorCode: 'PAYMENT_METHOD_REQUIRED', message: 'Choose a payment method.' }
  if (!input.paymentDate) return { ok: false, errorCode: 'PAYMENT_DATE_REQUIRED', message: 'Choose a payment date.' }
  return {
    ok: true,
    rpc: 'record_billing_entry_v2',
    params: {
      p_patient_id: input.patientId,
      p_entry_kind: input.mode,
      p_package_name: input.packageName ?? null,
      p_package_total_sessions: input.packageTotalSessions ?? null,
      p_package_per_session_amount: input.packagePerSessionAmount ?? null,
      p_appointment_type_id: input.appointmentTypeId ?? null,
      p_package_starts_on: input.packageStartsOn ?? null,
      p_amount: paymentAmount,
      p_payment_method: input.paymentMethod,
      p_payment_date: input.paymentDate,
      p_notes: input.paymentNotes ?? null,
    },
    summary: {
      patientId: input.patientId,
      mode: input.mode,
      packageName: input.packageName?.trim() || null,
      totalSessions: input.packageTotalSessions ?? null,
      packageTotal,
      amount: paymentAmount,
      method: input.paymentMethod,
      date: input.paymentDate,
    },
  }
}

export function validateReasonedMutation(kind: ReasonedKind, input: ReasonedInput): Validated<ReasonedSummary> {
  if (!input.entityId) return { ok: false, errorCode: 'BILLING_ENTITY_REQUIRED', message: 'A billing record is required.' }
  const reason = input.reason.trim()
  if (!reason) return { ok: false, errorCode: 'BILLING_REASON_REQUIRED', message: 'A reason is required for this audited change.' }
  if (kind === 'record_refund') {
    if (!Number.isFinite(input.amount) || Number(input.amount) <= 0) return { ok: false, errorCode: 'REFUND_INVALID_AMOUNT', message: 'Refund amount must be greater than zero.' }
    if (!input.refundMethod) return { ok: false, errorCode: 'REFUND_METHOD_REQUIRED', message: 'Choose a refund method.' }
    if (!input.refundDate) return { ok: false, errorCode: 'REFUND_DATE_REQUIRED', message: 'Choose a refund date.' }
  }
  const rpc = kind
  let params: Record<string, unknown>
  if (kind === 'void_payment') params = { p_payment_id: input.entityId, p_reason: reason }
  else if (kind === 'cancel_package') params = { p_package_id: input.entityId, p_reason: reason }
  else if (kind === 'record_refund') params = { p_payment_id: input.entityId, p_amount: input.amount, p_refund_method: input.refundMethod, p_refund_date: input.refundDate, p_reason: reason }
  else if (kind === 'void_refund') params = { p_refund_id: input.entityId, p_reason: reason }
  else params = { p_appointment_id: input.entityId, p_adjusted_amount: input.adjustedAmount, p_reason: reason }
  return { ok: true, rpc, params, summary: { kind, entityId: input.entityId, reason, amount: kind === 'record_refund' ? Number(input.amount) : kind === 'adjust_appointment_fee' ? Number(input.adjustedAmount) : null } }
}

export async function callBillingRpc(
  supabase: SupabaseClient,
  name: string,
  params: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(name, params)
  if (error) {
    logger.error(`billing/${name}`, error, context)
    return { success: false, errorCode: error.code ?? 'BILLING_MUTATION_FAILED', message: error.message }
  }
  return data as RpcResult
}
