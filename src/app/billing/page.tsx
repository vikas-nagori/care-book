import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { BillingView } from './billing-view'
import { buildPaymentDueRows } from '@/lib/billing/payment-due'

const PAGE_SIZE = 50

const BILLING_TABS = ['overview', 'payment_due', 'payments', 'packages'] as const
type BillingTab = (typeof BILLING_TABS)[number]

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ tab?: string; new?: string }> }) {
  await requireAdmin()
  const supabase = await createClient()

  const { tab, new: newEntry } = await searchParams
  const initialTab: BillingTab = BILLING_TABS.includes(tab as BillingTab)
    ? (tab as BillingTab)
    : 'overview'

  const now = new Date()
  const monthStart = format(startOfMonth(now), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd')
  const lastMonth = subMonths(now, 1)
  const lastMonthStart = format(startOfMonth(lastMonth), 'yyyy-MM-dd')
  const lastMonthEnd = format(endOfMonth(lastMonth), 'yyyy-MM-dd')
  const lastMonthLabel = format(lastMonth, 'MMMM')

  const [
    { data: packages, error: packagesError, count: packagesCount },
    { data: payments, error: paymentsError, count: paymentsCount },
    { data: patients, error: patientsError },
    { data: appointments, error: appointmentsError },
    { data: appointmentPayments, error: appointmentPaymentsError },
    { data: allPayments, error: allPaymentsError },
    { data: monthPayments, error: monthPaymentsError },
    { data: packageTemplates, error: packageTemplatesError },
  ] = await Promise.all([
    supabase.from('packages').select('*, patient:patients(id, name)', { count: 'exact' }).order('created_at', { ascending: false }).range(0, PAGE_SIZE - 1),
    supabase
      .from('payments')
      .select('*, patient:patients(id, name), package:packages(id, name)', { count: 'exact' })
      .order('date', { ascending: false })
      .range(0, PAGE_SIZE - 1),
    supabase.from('patients').select('id, name').order('name'),
    supabase.from('appointments')
      .select('id, patient_id, date, time, status, payment_status, fee, type, patient:patients(id, name)')
      .in('status', ['completed', 'scheduled'])
      .order('date', { ascending: true }),
    supabase.from('appointment_payments').select('payment_id, amount_applied'),
    // All payments (id, patient, amount) — unpaginated — to compute each patient's unspent
    // advance credit, so the entry form preview reflects pooled FIFO allocation (migration 014).
    supabase.from('payments').select('id, patient_id, amount'),
    // This-month payments — unpaginated — for the "Received (this month)" tile.
    supabase.from('payments').select('amount').gte('date', monthStart).lte('date', monthEnd),
    supabase.from('package_templates').select('*').order('created_at', { ascending: false }),
  ])

  if (packagesError) logger.error('BillingPage/packages', packagesError)
  if (paymentsError) logger.error('BillingPage/payments', paymentsError)
  if (patientsError) logger.error('BillingPage/patients', patientsError)
  if (appointmentsError) logger.error('BillingPage/appointments', appointmentsError)
  if (appointmentPaymentsError) logger.error('BillingPage/appointmentPayments', appointmentPaymentsError)
  if (allPaymentsError) logger.error('BillingPage/allPayments', allPaymentsError)
  if (monthPaymentsError) logger.error('BillingPage/monthPayments', monthPaymentsError)
  if (packageTemplatesError) logger.error('BillingPage/packageTemplates', packageTemplatesError)

  // Billed (completed sessions' fees) per period — captures package + standalone sessions
  // without double-counting, since every session is an appointment carrying its own fee.
  const sumCompletedFees = (from: string, to: string) =>
    (appointments ?? []).reduce(
      (total, a) =>
        a.status === 'completed' && a.date >= from && a.date <= to
          ? total + Number(a.fee ?? 0)
          : total,
      0,
    )
  const billedThisMonth = sumCompletedFees(monthStart, monthEnd)
  const billedLastMonth = sumCompletedFees(lastMonthStart, lastMonthEnd)
  const receivedThisMonth = (monthPayments ?? []).reduce((s, p) => s + Number(p.amount), 0)

  const linkedSessionCounts = (appointmentPayments ?? []).reduce<Record<string, number>>((counts, row) => {
    counts[row.payment_id] = (counts[row.payment_id] ?? 0) + 1
    return counts
  }, {})

  // Unspent credit per payment, then rolled up per patient (payment.amount − Σ amount_applied).
  const appliedByPayment = (appointmentPayments ?? []).reduce<Record<string, number>>((sums, row) => {
    sums[row.payment_id] = (sums[row.payment_id] ?? 0) + Number(row.amount_applied ?? 0)
    return sums
  }, {})
  const patientCredit = (allPayments ?? []).reduce<Record<string, number>>((credit, payment) => {
    const unspent = Math.max(0, Number(payment.amount ?? 0) - (appliedByPayment[payment.id] ?? 0))
    credit[payment.patient_id] = (credit[payment.patient_id] ?? 0) + unspent
    return credit
  }, {})

  const paymentDueRows = buildPaymentDueRows({
    appointments: (appointments ?? []).map((appointment) => ({
      ...appointment,
      patient: Array.isArray(appointment.patient)
        ? (appointment.patient[0] ?? null)
        : (appointment.patient ?? null),
    })),
    payments: allPayments ?? [],
    appointmentPayments: appointmentPayments ?? [],
    // Name credit-only patients (overpaid, no completed unpaid session to source a name from).
    patientNames: (patients ?? []).reduce<Record<string, string>>((names, patient) => {
      names[patient.id] = patient.name
      return names
    }, {}),
  })

  return (
    <div className="p-4 md:p-6">
      <BillingView
        packages={packages ?? []}
        packagesTotalCount={packagesCount ?? 0}
        packageTemplates={packageTemplates ?? []}
        payments={payments ?? []}
        paymentsTotalCount={paymentsCount ?? 0}
        pageSize={PAGE_SIZE}
        patients={patients ?? []}
        appointments={appointments ?? []}
        linkedSessionCounts={linkedSessionCounts}
        patientCredit={patientCredit}
        paymentDueRows={paymentDueRows}
        billedThisMonth={billedThisMonth}
        billedLastMonth={billedLastMonth}
        billedLastMonthLabel={lastMonthLabel}
        receivedThisMonth={receivedThisMonth}
        initialTab={initialTab}
        initialEntryOpen={newEntry === '1'}
      />
    </div>
  )
}
