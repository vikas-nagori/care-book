import { notFound, redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { logger } from '@/lib/logger'
import { formatDateOnly, getZonedCalendarContext } from '@/lib/timezone'
import { getUserTimeZone } from '@/lib/timezone/server'
import { buildAppointmentTypeBreakdown, type AppointmentTypeBreakdownRow } from '@/lib/billing/appointment-type-breakdown'
import { buildMonthlyBilledSeries, type BilledMonthBucket } from '@/lib/billing/monthly-billed-series'
import { buildNetReceivedMetric } from '@/lib/billing/received-metric'
import { groupMetricRowsByDate, paginateDateGroups } from '@/lib/billing/date-grouped-records'
import { parsePageParam } from '@/lib/pagination'
import { MetricDetail, type MetricRow } from './metric-detail'
import { BilledTrendDetail } from './billed-trend-detail'

// Drill-down behind a billing money tile. "Billed" / "Received" tiles list the records that sum to
// the figure, grouped into a collapsed accordion per date so each day's own total reads at a glance;
// pagination runs over whole dates, never part of one. The "Billed last month" tile instead opens a
// month-by-month trendline of total billed since the org's first billed month. Admin-only.
type MetricView = 'list' | 'trend'
type MetricKind = 'billed' | 'received'
const METRICS: Record<string, { title: string; kind: MetricKind; view: MetricView; monthsAgo: number }> = {
  'billed-this-month': { title: 'Total billed', kind: 'billed', view: 'list', monthsAgo: 0 },
  'billed-last-month': { title: 'Monthly billed trend', kind: 'billed', view: 'trend', monthsAgo: 1 },
  'received-this-month': { title: 'Received', kind: 'received', view: 'list', monthsAgo: 0 },
}

/** Dates per page. Whole date groups, so a day's total on a header is always that day's full total. */
const DATE_PAGE_SIZE = 15

type MonthTotalsRow = {
  month: string
  appointment_type: string | null
  amount: number | string | null
  session_count: number | string | null
}

function normalizePatient(patient: unknown): string {
  const p = Array.isArray(patient) ? patient[0] : patient
  return (p as { name?: string } | null)?.name ?? 'Unknown patient'
}

function toBuckets(rows: MonthTotalsRow[]): BilledMonthBucket[] {
  return rows.map((row) => ({
    month: row.month,
    type: row.appointment_type,
    amount: row.amount,
    sessionCount: row.session_count,
  }))
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

  // Trend view — month-by-month total billed, aggregated by Postgres so the payload stays a few
  // dozen rows however long the clinic has been running. The second call re-counts every month up
  // to today's day of the month, which powers the "billed till date" pace comparison.
  if (config.view === 'trend') {
    const tillDay = Number(calendar.date.slice(8, 10))

    const [fullTotals, tillDateTotals] = await Promise.all([
      fetchAllRows<MonthTotalsRow>((from, to) =>
        supabase.rpc('get_billed_month_totals_v1', { p_till_day: null }).range(from, to),
      ),
      fetchAllRows<MonthTotalsRow>((from, to) =>
        supabase.rpc('get_billed_month_totals_v1', { p_till_day: tillDay }).range(from, to),
      ),
    ])
    if (fullTotals.error) logger.error('BillingMetric/trend/full', fullTotals.error, { metric })
    if (tillDateTotals.error) logger.error('BillingMetric/trend/tillDate', tillDateTotals.error, { metric })

    const currentMonth = calendar.monthStart.slice(0, 7)
    const fullSeries = buildMonthlyBilledSeries(toBuckets(fullTotals.data), currentMonth)
    const tillDateSeries = buildMonthlyBilledSeries(toBuckets(tillDateTotals.data), currentMonth)
    const subtitle = fullSeries.length
      ? `${fullSeries[0].label} – ${fullSeries[fullSeries.length - 1].label}`
      : 'No billed sessions yet'

    return (
      <BilledTrendDetail
        title={config.title}
        subtitle={subtitle}
        fullSeries={fullSeries}
        tillDateSeries={tillDateSeries}
        tillDay={tillDay}
      />
    )
  }

  // List views — every record for the period, grouped by date. The whole period is read (in chunks,
  // so PostgREST's max-rows cap can never silently drop records) because the headline total, the
  // per-type breakdown and every date total must all reflect the period, not one page of it.
  const isCurrentMonth = config.monthsAgo === 0
  const from = isCurrentMonth ? calendar.monthStart : calendar.previousMonthStart
  const to = isCurrentMonth ? calendar.monthEnd : calendar.previousMonthEnd
  const periodLabel = isCurrentMonth
    ? calendar.monthLabel
    : formatDateOnly(calendar.previousMonthStart, 'MMMM yyyy')

  const page = parsePageParam(pageParam)

  let rows: MetricRow[] = []
  let breakdown: AppointmentTypeBreakdownRow[] | undefined
  let total = 0

  if (config.kind === 'billed') {
    const { data, error } = await fetchAllRows<{
      id: string
      date: string
      time: string
      type: string | null
      fee: number | null
      patient: unknown
    }>((rangeStart, rangeEnd) =>
      supabase
        .from('appointments')
        .select('id, date, time, type, fee, patient:patients(name)')
        .eq('status', 'completed')
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: false })
        .order('id', { ascending: false })
        .range(rangeStart, rangeEnd),
    )
    if (error) logger.error('BillingMetric/billed', error, { metric })

    total = data.reduce((sum, a) => sum + Number(a.fee ?? 0), 0)
    breakdown = buildAppointmentTypeBreakdown(data.map((a) => ({ type: a.type, fee: a.fee })))
    rows = data.map((a) => ({
      id: a.id,
      date: a.date,
      title: normalizePatient(a.patient),
      meta: a.type ?? undefined,
      amount: Number(a.fee ?? 0),
    }))
  } else {
    const [periodPayments, periodRefunds, refundReversals] = await Promise.all([
      fetchAllRows<{
        id: string
        date: string
        amount: number | string
        payment_method: string | null
        status: string
        patient: unknown
      }>((rangeStart, rangeEnd) =>
        supabase
          .from('payments')
          .select('id, date, amount, payment_method, status, patient:patients(name)')
          .gte('date', from)
          .lte('date', to)
          .range(rangeStart, rangeEnd),
      ),
      fetchAllRows<{
        id: string
        refund_date: string
        amount: number | string
        refund_method: string
        patient: unknown
      }>((rangeStart, rangeEnd) =>
        supabase
          .from('refunds')
          .select('id, refund_date, amount, refund_method, patient:patients(name)')
          .gte('refund_date', from)
          .lte('refund_date', to)
          .range(rangeStart, rangeEnd),
      ),
      fetchAllRows<{ refund_id: string }>((rangeStart, rangeEnd) =>
        supabase.from('refund_reversals').select('refund_id').range(rangeStart, rangeEnd),
      ),
    ])
    if (periodPayments.error) logger.error('BillingMetric/received/payments', periodPayments.error, { metric })
    if (periodRefunds.error) logger.error('BillingMetric/received/refunds', periodRefunds.error, { metric })
    if (refundReversals.error) logger.error('BillingMetric/received/refundReversals', refundReversals.error, { metric })

    const received = buildNetReceivedMetric({
      payments: periodPayments.data.map((payment) => ({
        ...payment,
        amount: payment.amount,
        patientName: normalizePatient(payment.patient),
      })),
      refunds: periodRefunds.data.map((refund) => ({
        ...refund,
        patientName: normalizePatient(refund.patient),
      })),
      reversedRefundIds: new Set(refundReversals.data.map((reversal) => reversal.refund_id)),
    })
    total = received.total
    rows = received.rows
  }

  const allGroups = groupMetricRowsByDate(rows)
  const { groups, totalPages } = paginateDateGroups(allGroups, { page, pageSize: DATE_PAGE_SIZE })
  if (page > totalPages) redirect(`/billing/metrics/${metric}?page=${totalPages}`)

  return (
    <MetricDetail
      title={config.title}
      subtitle={periodLabel}
      total={total}
      groups={groups}
      unitLabel={config.kind === 'billed' ? 'session' : 'record'}
      breakdown={breakdown}
      totalCount={rows.length}
      pagination={{ page, totalPages, basePath: `/billing/metrics/${metric}` }}
      emptyLabel={config.kind === 'billed' ? 'No completed sessions in this period.' : 'No payments received in this period.'}
    />
  )
}
