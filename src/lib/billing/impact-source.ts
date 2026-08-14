import type { BillingImpactInput, FundingScope, ReceiptStatus } from './impact-report.ts'

type Row = Record<string, unknown>

export type SupabaseBillingSource = Record<string, Row[] | undefined>

const text = (value: unknown): string => String(value ?? '')
const optionalText = (value: unknown): string | null => value == null ? null : String(value)
const number = (value: unknown): number => Number(value ?? 0)

export function mapSupabaseBillingSource(source: SupabaseBillingSource): BillingImpactInput {
  return {
    clinics: (source.clinics ?? []).map((row) => ({ id: text(row.id), name: text(row.name) })),
    patients: (source.patients ?? []).map((row) => ({
      id: text(row.id), clinicId: text(row.clinic_id), name: text(row.name),
    })),
    appointmentTypes: (source.appointment_types ?? []).map((row) => ({
      id: text(row.id), clinicId: text(row.clinic_id), name: text(row.name),
      isDefault: Boolean(row.is_default), isShared: Boolean(row.is_shared), sortOrder: number(row.sort_order),
    })),
    appointments: (source.appointments ?? []).map((row) => ({
      id: text(row.id), clinicId: text(row.clinic_id), patientId: text(row.patient_id),
      appointmentTypeId: optionalText(row.appointment_type_id), date: text(row.date), time: text(row.time),
      status: text(row.status), fee: number(row.fee), paymentStatus: optionalText(row.payment_status),
      createdAt: text(row.created_at),
    })),
    packages: (source.packages ?? []).map((row) => ({
      id: text(row.id), clinicId: text(row.clinic_id), patientId: text(row.patient_id), name: text(row.name),
      totalSessions: number(row.total_sessions), usedSessions: number(row.used_sessions),
      totalAmount: number(row.total_amount), perSessionAmount: number(row.per_session_amount),
      paidAmount: number(row.paid_amount), status: text(row.status),
      appointmentTypeId: optionalText(row.appointment_type_id), startsOn: optionalText(row.starts_on),
      createdAt: text(row.created_at),
    })),
    payments: (source.payments ?? []).map((row) => ({
      id: text(row.id), clinicId: text(row.clinic_id), patientId: text(row.patient_id),
      packageId: optionalText(row.package_id), amount: number(row.amount), paymentMethod: text(row.payment_method),
      date: text(row.date), createdAt: text(row.created_at),
      fundingScope: optionalText(row.funding_scope) as FundingScope | null ?? undefined,
      status: optionalText(row.status) as ReceiptStatus | null ?? undefined,
    })),
    appointmentPayments: (source.appointment_payments ?? []).map((row) => ({
      paymentId: text(row.payment_id), appointmentId: text(row.appointment_id),
      amountApplied: number(row.amount_applied), createdAt: text(row.created_at),
    })),
    packageSessionAllocations: (source.package_session_allocations ?? []).map((row) => ({
      packageId: text(row.package_id), appointmentId: text(row.appointment_id),
      lifecycle: optionalText(row.lifecycle), createdAt: optionalText(row.created_at) ?? undefined,
    })),
    refunds: (source.refunds ?? []).map((row) => ({
      id: text(row.id), clinicId: text(row.clinic_id), patientId: text(row.patient_id),
      paymentId: text(row.payment_id), amount: number(row.amount), refundMethod: text(row.refund_method),
      refundDate: text(row.refund_date), reason: text(row.reason), createdAt: text(row.created_at),
    })),
    refundReversals: (source.refund_reversals ?? []).map((row) => ({
      id: text(row.id), refundId: text(row.refund_id), createdAt: text(row.created_at),
    })),
  }
}
