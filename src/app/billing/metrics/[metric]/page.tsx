import { notFound, redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { formatDateOnly, getZonedCalendarContext } from '@/lib/timezone'
import { getUserTimeZone } from '@/lib/timezone/server'
import { buildAppointmentTypeBreakdown, type AppointmentTypeBreakdownRow } from '@/lib/billing/appointment-type-breakdown'
import { buildMonthlyBilledSeries } from '@/lib/billing/monthly-billed-series'
import { buildNetReceivedMetric } from '@/lib/billing/received-metric'
import { parsePageParam } from '@/lib/pagination'
import { MetricDetail, type MetricRow } from './metric-detail'
import { BilledTrendDetail } from './billed-trend-detail'

// Drill-down behind a billing money tile. "Billed" / "Received" tiles list the exact records that sum
// to the figure (paginated — these lists get very long); the "Billed last month" tile instead opens a
// month-by-month trendline of total billed since the org's first billed month. Admin-only.
type MetricView = 'list' | 'trend'
type MetricKind = 'billed' | 'received'
const METRICS: Record<string, { title: string; kind: MetricKind; view: MetricView; monthsAgo: number }> = {
  'billed-this-month': { title: 'Total billed', kind: 'billed', view: 'list', monthsAgo: 0 },
  'billed-last-month': { title: 'Monthly billed trend', kind: 'billed', view: 'trend', monthsAgo: 1 },
  'received-this-month': { title: 'Received', kind: 'received', view: 'list', monthsAgo: 0 },
}

const PAGE_SIZE = 25

function normalizePatient(patient: unknown): string {
  const p = Array.isArray(patient) ? patient[0] : patient
  return (p as { name?: string } | null)?.name ?? 'Unknown patient'
}

export default async function BillingMetricPage({
  params,
  searchParams,
}: {
  params: Promise<{ metric: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { metric } = await params
  const { page: pageParam } = await searchParams
  await requireAdmin()
  const config = METRICS[metric]
  if (!config) notFound()

  const supabase = await createClient()
  const userTimeZone = await getUserTimeZone()
  const now = new Date()
  const calendar = getZonedCalendarContext(now, userTimeZone)

  // Trend view — month-by-month total billed (completed session fees) since inception.
  if (config.view === 'trend') {
    const { data, error } = await supabase
      .from('appointments')
      .select('date, fee')
      .eq('status', 'completed')
      .order('date', { ascending: true })
    if (error) logger.error('BillingMetric/trend', error, { metric })

    const series = buildMonthlyBilledSeries(
      (data ?? []).map((a) => ({ date: a.date, fee: a.fee })),
      calendar.monthStart.slice(0, 7),
    )
    const total = series.reduce((sum, point) => sum + point.amount, 0)
    const subtitle = series.length
      ? `${series[0].label} – ${series[series.length - 1].label}`
      : 'No billed sessions yet'

    return <BilledTrendDetail title={config.title} subtitle={subtitle} total={total} series={series} />
  }

  // List views — paginated records for the period.
  const isCurrentMonth = config.monthsAgo === 0
  const from = isCurrentMonth ? calendar.monthStart : calendar.previousMonthStart
  const to = isCurrentMonth ? calendar.monthEnd : calendar.previousMonthEnd
  const periodLabel = isCurrentMonth
    ? calendar.monthLabel
    : formatDateOnly(calendar.previousMonthStart, 'MMMM yyyy')

  const page = parsePageParam(pageParam)
  const rangeStart = (page - 1) * PAGE_SIZE
  const rangeEnd = rangeStart + PAGE_SIZE - 1

  let rows: MetricRow[] = []
  // The tile total and per-type breakdown must reflect the WHOLE period, not the visible page, so
  // they come from a separate lightweight aggregate query (amounts/types only, no join, no range).
  let breakdown: AppointmentTypeBreakdownRow[] | undefined
  let total = 0
  let totalCount = 0

  if (config.kind === 'billed') {
    const { data: aggregate, error: aggregateError } = await supabase
      .from('appointments')
      .select('type, fee')
      .eq('status', 'completed')
      .gte('date', from)
      .lte('date', to)
    if (aggregateError) logger.error('BillingMetric/billed/aggregate', aggregateError, { metric })
    total = (aggregate ?? []).reduce((sum, a) => sum + Number(a.fee ?? 0), 0)
    breakdown = buildAppointmentTypeBreakdown((aggregate ?? []).map((a) => ({ type: a.type, fee: a.fee })))

    const { data, count, error } = await supabase
      .from('appointments')
      .select('id, date, time, type, fee, patient:patients(name)', { count: 'exact' })
      .eq('status', 'completed')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .order('id', { ascending: false })
      .range(rangeStart, rangeEnd)
    if (error) logger.error('BillingMetric/billed', error, { metric })
    totalCount = count ?? 0
    rows = (data ?? []).map((a) => ({
      id: a.id,
      date: a.date,
      title: normalizePatient(a.patient),
      meta: a.type,
      amount: Number(a.fee ?? 0),
    }))
  } else {
    const [
      { data: periodPayments, error: paymentsError },
      { data: periodRefunds, error: refundsError },
      { data: refundReversals, error: reversalsError },
    ] = await Promise.all([
      supabase
        .from('payments')
        .select('id, date, amount, payment_method, status, patient:patients(name)')
        .gte('date', from)
        .lte('date', to),
      supabase
        .from('refunds')
        .select('id, refund_date, amount, refund_method, patient:patients(name)')
        .gte('refund_date', from)
        .lte('refund_date', to),
      supabase.from('refund_reversals').select('refund_id'),
    ])
    if (paymentsError) logger.error('BillingMetric/received/payments', paymentsError, { metric })
    if (refundsError) logger.error('BillingMetric/received/refunds', refundsError, { metric })
    if (reversalsError) logger.error('BillingMetric/received/refundReversals', reversalsError, { metric })

    const received = buildNetReceivedMetric({
      payments: (periodPayments ?? []).map((payment) => ({
        ...payment,
        patientName: normalizePatient(payment.patient),
      })),
      refunds: (periodRefunds ?? []).map((refund) => ({
        ...refund,
        patientName: normalizePatient(refund.patient),
      })),
      reversedRefundIds: new Set((refundReversals ?? []).map((reversal) => reversal.refund_id)),
    })
    total = received.total
    totalCount = received.rows.length
    rows = received.rows.slice(rangeStart, rangeEnd + 1)
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  if (page > totalPages) redirect(`/billing/metrics/${metric}?page=${totalPages}`)

  return (
    <MetricDetail
      title={config.title}
      subtitle={periodLabel}
      total={total}
      rows={rows}
      breakdown={breakdown}
      totalCount={totalCount}
      pagination={{ page, totalPages, basePath: `/billing/metrics/${metric}` }}
      emptyLabel={config.kind === 'billed' ? 'No completed sessions in this period.' : 'No payments received in this period.'}
    />
  )
}
