import type { BillingMode, Package, Payment } from '@/lib/supabase/types'

export type BillingTimelinePackage = Package & {
  patient: { id: string; name: string } | null
}

export type BillingTimelinePayment = Payment & {
  patient: { id: string; name: string } | null
  package: { id: string; name: string } | null
}

export type BillingTimelineItem =
  | {
      id: string
      type: 'package_created'
      sortDate: string
      patientName: string
      packageName: string
      totalSessions: number
      usedSessions: number
      totalAmount: number
      paidAmount: number
      status: Package['status']
    }
  | {
      id: string
      type: 'payment_recorded'
      sortDate: string
      patientName: string
      amount: number
      paymentMethod: string
      notes: string | null
      packageName: string | null
      linkedSessionCount: number
    }

export function getBillingModeLabel(mode: BillingMode) {
  switch (mode) {
    case 'payment_only':
      return 'Only payment'
    case 'package_with_payment':
      return 'Package + payment'
  }
}

export function buildBillingTimelineItems({
  packages,
  payments,
  linkedSessionCounts,
}: {
  packages: BillingTimelinePackage[]
  payments: BillingTimelinePayment[]
  linkedSessionCounts: Record<string, number>
}) {
  const packageItems: BillingTimelineItem[] = packages.map((pkg) => ({
    id: pkg.id,
    type: 'package_created',
    sortDate: pkg.created_at,
    patientName: pkg.patient?.name ?? 'Unknown patient',
    packageName: pkg.name,
    totalSessions: pkg.total_sessions,
    usedSessions: pkg.used_sessions,
    totalAmount: Number(pkg.total_amount),
    paidAmount: Number(pkg.paid_amount),
    status: pkg.status,
  }))

  const paymentItems: BillingTimelineItem[] = payments.map((payment) => ({
    id: payment.id,
    type: 'payment_recorded',
    sortDate: payment.date,
    patientName: payment.patient?.name ?? 'Unknown patient',
    amount: Number(payment.amount),
    paymentMethod: payment.payment_method,
    notes: payment.notes,
    packageName: payment.package?.name ?? null,
    linkedSessionCount: linkedSessionCounts[payment.id] ?? 0,
  }))

  return [...packageItems, ...paymentItems].sort((left, right) =>
    right.sortDate.localeCompare(left.sortDate),
  )
}
