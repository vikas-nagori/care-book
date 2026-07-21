import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { formatDateOnly, getZonedCalendarContext } from '@/lib/timezone'
import { getUserTimeZone } from '@/lib/timezone/server'
import { buildAppointmentTypeBreakdown, type AppointmentTypeBreakdownRow } from '@/lib/billing/appointment-type-breakdown'
import { MetricDetail, type MetricRow } from './metric-detail'

// Drill-down behind a billing money tile: the exact records that sum to the figure, with the total
// made visible. "Billed" tiles list completed sessions (each carries its own fee); "Received" lists
// payments. Admin-only, mirroring the Billing page guard.
type MetricKind = 'billed' | 'received'
const METRICS: Record<string, { title: string; kind: MetricKind; monthsAgo: number }> = {
  'billed-this-month': { title: 'Total billed', kind: 'billed', monthsAgo: 0 },
  'billed-last-month': { title: 'Billed last month', kind: 'billed', monthsAgo: 1 },
  'received-this-month': { title: 'Received', kind: 'received', monthsAgo: 0 },
}

function normalizePatient(patient: unknown): string {
  const p = Array.isArray(patient) ? patient[0] : patient
  return (p as { name?: string } | null)?.name ?? 'Unknown patient'
}

export default async function BillingMetricPage({ params }: { params: Promise<{ metric: string }> }) {
  const { metric } = await params
  await requireAdmin()
  const config = METRICS[metric]
  if (!config) notFound()

  const supabase = await createClient()
  const userTimeZone = await getUserTimeZone()
  const now = new Date()
  const calendar = getZonedCalendarContext(now, userTimeZone)
  const isCurrentMonth = config.monthsAgo === 0
  const from = isCurrentMonth ? calendar.monthStart : calendar.previousMonthStart
  const to = isCurrentMonth ? calendar.monthEnd : calendar.previousMonthEnd
  const periodLabel = isCurrentMonth
    ? calendar.monthLabel
    : formatDateOnly(calendar.previousMonthStart, 'MMMM yyyy')

  let rows: MetricRow[] = []
  // Only the "billed" drill-downs get the per-appointment-type breakdown strip (each completed
  // session carries its own type + fee). "Received" lists payments, which have no session type.
  let breakdown: AppointmentTypeBreakdownRow[] | undefined

  if (config.kind === 'billed') {
    const { data, error } = await supabase
      .from('appointments')
      .select('id, date, time, type, fee, patient:patients(name)')
      .eq('status', 'completed')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
    if (error) logger.error('BillingMetric/billed', error, { metric })
    rows = (data ?? []).map((a) => ({
      id: a.id,
      date: a.date,
      title: normalizePatient(a.patient),
      meta: a.type,
      amount: Number(a.fee ?? 0),
    }))
    breakdown = buildAppointmentTypeBreakdown(
      (data ?? []).map((a) => ({ type: a.type, fee: a.fee })),
    )
  } else {
    const { data, error } = await supabase
      .from('payments')
      .select('id, date, amount, payment_method, patient:patients(name)')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
    if (error) logger.error('BillingMetric/received', error, { metric })
    rows = (data ?? []).map((p) => ({
      id: p.id,
      date: p.date,
      title: normalizePatient(p.patient),
      meta: p.payment_method ?? undefined,
      amount: Number(p.amount ?? 0),
    }))
  }

  const total = rows.reduce((sum, r) => sum + r.amount, 0)

  return (
    <MetricDetail
      title={config.title}
      subtitle={periodLabel}
      total={total}
      rows={rows}
      breakdown={breakdown}
      emptyLabel={config.kind === 'billed' ? 'No completed sessions in this period.' : 'No payments received in this period.'}
    />
  )
}
