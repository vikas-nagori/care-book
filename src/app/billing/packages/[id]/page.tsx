import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { PackageDetail, type PackageSession } from './package-detail'

// Detail behind a billing package: which sessions have been taken under it, with their dates.
// Sessions come from the package_session_allocations ledger (admin-only via RLS) joined to the
// appointments that consumed a package session. Admin-only, mirroring the Billing page guard.
type AllocationRow = {
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

  const [{ data: pkg, error: packageError }, { data: allocations, error: allocationsError }] = await Promise.all([
    supabase.from('packages').select('*, patient:patients(id, name)').eq('id', id).single(),
    supabase
      .from('package_session_allocations')
      .select('appointment:appointments(id, date, time, type, fee, status)')
      .eq('package_id', id),
  ])

  if (packageError) logger.error('PackageDetail/package', packageError, { id })
  if (!pkg) notFound()
  if (allocationsError) logger.error('PackageDetail/allocations', allocationsError, { id })

  // Oldest session first, matching how a course of treatment reads chronologically.
  const sessions: PackageSession[] = (allocations ?? [])
    .map((row) => normalizeAppointment((row as AllocationRow).appointment))
    .filter((appointment): appointment is NonNullable<typeof appointment> => appointment !== null)
    .map((appointment) => ({
      id: appointment.id,
      date: appointment.date,
      time: appointment.time,
      type: appointment.type,
      fee: appointment.fee,
      status: appointment.status,
    }))
    .sort((left, right) => (left.date === right.date
      ? (left.time ?? '').localeCompare(right.time ?? '')
      : left.date.localeCompare(right.date)))

  const patient = Array.isArray(pkg.patient) ? (pkg.patient[0] ?? null) : pkg.patient

  return (
    <PackageDetail
      patientName={patient?.name ?? 'Unknown patient'}
      name={pkg.name}
      status={pkg.status}
      usedSessions={pkg.used_sessions}
      totalSessions={pkg.total_sessions}
      paidAmount={Number(pkg.paid_amount)}
      totalAmount={Number(pkg.total_amount)}
      sessions={sessions}
    />
  )
}
