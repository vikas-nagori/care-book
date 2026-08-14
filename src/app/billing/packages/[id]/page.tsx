import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { PackageDetail, type PackageSession } from './package-detail'

// Detail behind a billing package: which sessions have been taken under it, with their dates.
// Sessions come from the package_session_allocations ledger (admin-only via RLS) joined to the
// appointments that consumed a package session. Admin-only, mirroring the Billing page guard.
type AllocationRow = {
  id: string
  appointment_reference_id: string
  lifecycle: 'scheduled' | 'availed' | 'released'
  released_at: string | null
  release_reason: string | null
  appointment:
    | { id: string; date: string; time: string | null; type: string | null; fee: number | null; status: string }
    | { id: string; date: string; time: string | null; type: string | null; fee: number | null; status: string }[]
    | null
}

function normalizeAppointment(appointment: AllocationRow['appointment']) {
  return Array.isArray(appointment) ? (appointment[0] ?? null) : appointment
}

export default async function PackageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireAdmin()
  const supabase = await createClient()

  const [{ data: pkg, error: packageError }, { data: balance, error: balanceError }, { data: allocations, error: allocationsError }] = await Promise.all([
    supabase.from('packages').select('*, patient:patients(id, name)').eq('id', id).single(),
    supabase.from('package_billing_balances_v2').select('*').eq('package_id', id).single(),
    supabase
      .from('package_session_allocations')
      .select('id, appointment_reference_id, lifecycle, released_at, release_reason, appointment:appointments(id, date, time, type, fee, status)')
      .eq('package_id', id)
      .order('created_at', { ascending: true }),
  ])

  if (packageError) logger.error('PackageDetail/package', packageError, { id })
  if (!pkg) notFound()
  if (balanceError) logger.error('PackageDetail/balance', balanceError, { id })
  if (allocationsError) logger.error('PackageDetail/allocations', allocationsError, { id })

  // Oldest session first, matching how a course of treatment reads chronologically.
  const sessions: PackageSession[] = (allocations ?? [])
    .map((row) => ({ row: row as AllocationRow, appointment: normalizeAppointment((row as AllocationRow).appointment) }))
    .map(({ row, appointment }) => ({
      id: row.id,
      appointmentReferenceId: row.appointment_reference_id,
      date: appointment?.date ?? null,
      time: appointment?.time ?? null,
      type: appointment?.type ?? null,
      fee: appointment?.fee ?? null,
      appointmentStatus: appointment?.status ?? null,
      lifecycle: row.lifecycle,
      releasedAt: row.released_at,
      releaseReason: row.release_reason,
    }))
    .sort((left, right) => {
      const leftDate = left.date ?? left.releasedAt ?? ''
      const rightDate = right.date ?? right.releasedAt ?? ''
      return leftDate === rightDate ? (left.time ?? '').localeCompare(right.time ?? '') : leftDate.localeCompare(rightDate)
    })

  const patient = Array.isArray(pkg.patient) ? (pkg.patient[0] ?? null) : pkg.patient

  return (
    <PackageDetail
      patientName={patient?.name ?? 'Unknown patient'}
      name={pkg.name}
      status={pkg.status}
      availedSessions={Number(balance?.availed_sessions ?? 0)}
      scheduledSessions={Number(balance?.scheduled_sessions ?? 0)}
      totalSessions={pkg.total_sessions}
      quoteAmount={Number(balance?.quote_amount ?? pkg.total_amount)}
      netReceived={Number(balance?.net_received ?? 0)}
      appliedAmount={Number(balance?.applied_amount ?? 0)}
      dueAmount={Number(balance?.due_amount ?? 0)}
      refundableCredit={Number(balance?.refundable_credit ?? 0)}
      completedAt={balance?.completed_at ?? null}
      sessions={sessions}
    />
  )
}
