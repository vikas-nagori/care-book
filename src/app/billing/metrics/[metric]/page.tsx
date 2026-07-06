import { notFound } from 'next/navigation'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { APPOINTMENT_TYPE_SHORT_LABEL } from '@/lib/appointments/appointment-type'
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
  const month = subMonths(new Date(), config.monthsAgo)
  const from = format(startOfMonth(month), 'yyyy-MM-dd')
  const to = format(endOfMonth(month), 'yyyy-MM-dd')
  const periodLabel = format(month, 'MMMM yyyy')

  let rows: MetricRow[] = []

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
      meta: APPOINTMENT_TYPE_SHORT_LABEL[a.type as 'home_visit' | 'clinic'],
      amount: Number(a.fee ?? 0),
    }))
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
      emptyLabel={config.kind === 'billed' ? 'No completed sessions in this period.' : 'No payments received in this period.'}
    />
  )
}
