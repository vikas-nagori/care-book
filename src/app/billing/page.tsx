import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { BillingView } from './billing-view'
import { buildV2PaymentBalanceRows } from '@/lib/billing/v2-balances'
import { CLINIC_TIME_ZONE, getZonedCalendarContext, getZonedDate } from '@/lib/timezone'
import { getUserTimeZone } from '@/lib/timezone/server'

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

  const userTimeZone = await getUserTimeZone()
  const now = new Date()
  const calendar = getZonedCalendarContext(now, userTimeZone)
  const clinicToday = getZonedDate(now, CLINIC_TIME_ZONE)

  const [
    { data: packages, error: packagesError, count: packagesCount },
    { data: fundablePackages, error: fundablePackagesError },
    { data: payments, error: paymentsError, count: paymentsCount },
    { data: patients, error: patientsError },
    { data: appointments, error: appointmentsError },
    { data: paymentApplications, error: paymentApplicationsError },
    { data: patientBalances, error: patientBalancesError },
    { data: packageBalances, error: packageBalancesError },
    { data: monthPayments, error: monthPaymentsError },
    { data: packageTemplates, error: packageTemplatesError },
    { data: appointmentTypes, error: appointmentTypesError },
    { data: monthRefunds, error: monthRefundsError },
    { data: recentRefunds, error: recentRefundsError },
  ] = await Promise.all([
    supabase.from('packages').select('*, patient:patients(id, name)', { count: 'exact' }).order('created_at', { ascending: false }).range(0, PAGE_SIZE - 1),
    supabase.from('packages').select('id, patient_id, name, status').neq('status', 'cancelled').order('created_at', { ascending: false }),
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
    supabase.from('payment_applications').select('payment_id').eq('status', 'active'),
    supabase.from('patient_billing_balances_v2').select('*'),
    supabase.from('package_billing_balances_v2').select('*'),
    // This-month payments — unpaginated — for the "Received (this month)" tile.
    supabase.from('payments').select('amount').eq('status', 'posted').gte('date', calendar.monthStart).lte('date', calendar.monthEnd),
    supabase.from('package_templates').select('*').order('created_at', { ascending: false }),
    supabase.from('appointment_types').select('id, name, session_rate').order('sort_order'),
    supabase.from('refunds').select('id, amount, refund_date').gte('refund_date', calendar.monthStart).lte('refund_date', calendar.monthEnd),
    supabase.from('refunds').select('id, payment_id, amount, refund_method, refund_date, reason').order('refund_date', { ascending: false }).range(0, 99),
  ])

  if (packagesError) logger.error('BillingPage/packages', packagesError)
  if (fundablePackagesError) logger.error('BillingPage/fundablePackages', fundablePackagesError)
  if (paymentsError) logger.error('BillingPage/payments', paymentsError)
  if (patientsError) logger.error('BillingPage/patients', patientsError)
  if (appointmentsError) logger.error('BillingPage/appointments', appointmentsError)
  if (paymentApplicationsError) logger.error('BillingPage/paymentApplications', paymentApplicationsError)
  if (patientBalancesError) logger.error('BillingPage/patientBalances', patientBalancesError)
  if (packageBalancesError) logger.error('BillingPage/packageBalances', packageBalancesError)
  if (monthPaymentsError) logger.error('BillingPage/monthPayments', monthPaymentsError)
  if (packageTemplatesError) logger.error('BillingPage/packageTemplates', packageTemplatesError)
  if (appointmentTypesError) logger.error('BillingPage/appointmentTypes', appointmentTypesError)
  if (monthRefundsError) logger.error('BillingPage/monthRefunds', monthRefundsError)
  if (recentRefundsError) logger.error('BillingPage/recentRefunds', recentRefundsError)

  // The recent history is capped for display, but every visible payment must include all of its
  // refunds so remaining refundable capacity and correction actions are exact.
  const visiblePaymentIds = (payments ?? []).map((payment) => payment.id)
  const { data: visiblePaymentRefunds, error: visiblePaymentRefundsError } = visiblePaymentIds.length > 0
    ? await supabase.from('refunds').select('id, payment_id, amount, refund_method, refund_date, reason').in('payment_id', visiblePaymentIds)
    : { data: [], error: null }
  if (visiblePaymentRefundsError) logger.error('BillingPage/visiblePaymentRefunds', visiblePaymentRefundsError)
  const refundRowsById = new Map([...(recentRefunds ?? []), ...(visiblePaymentRefunds ?? [])].map((refund) => [refund.id, refund]))
  const relevantRefundIds = [...new Set([...(monthRefunds ?? []).map((refund) => refund.id), ...refundRowsById.keys()])]
  const { data: reversedRefunds, error: reversedRefundsError } = relevantRefundIds.length > 0
    ? await supabase.from('refund_reversals').select('refund_id').in('refund_id', relevantRefundIds)
    : { data: [], error: null }
  if (reversedRefundsError) logger.error('BillingPage/reversedRefunds', reversedRefundsError)

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
  const billedThisMonth = sumCompletedFees(calendar.monthStart, calendar.monthEnd)
  const billedLastMonth = sumCompletedFees(calendar.previousMonthStart, calendar.previousMonthEnd)
  const reversedRefundIds = new Set((reversedRefunds ?? []).map((row) => row.refund_id))
  const receivedThisMonth = (monthPayments ?? []).reduce((s, p) => s + Number(p.amount), 0)
    - (monthRefunds ?? []).reduce((sum, refund) => sum + (refund.refund_date >= calendar.monthStart && refund.refund_date <= calendar.monthEnd && !reversedRefundIds.has(refund.id) ? Number(refund.amount) : 0), 0)

  const linkedSessionCounts = (paymentApplications ?? []).reduce<Record<string, number>>((counts, row) => {
    counts[row.payment_id] = (counts[row.payment_id] ?? 0) + 1
    return counts
  }, {})

  const paymentDueRows = buildV2PaymentBalanceRows({ patients: patients ?? [], patientBalances: patientBalances ?? [], packageBalances: packageBalances ?? [] })
  const packageBalanceMap = Object.fromEntries((packageBalances ?? []).map((balance) => [balance.package_id, balance]))

  return (
    <div className="p-4 md:p-6">
      <BillingView
        packages={packages ?? []}
        fundablePackages={fundablePackages ?? []}
        packagesTotalCount={packagesCount ?? 0}
        packageTemplates={packageTemplates ?? []}
        appointmentTypes={appointmentTypes ?? []}
        payments={payments ?? []}
        paymentsTotalCount={paymentsCount ?? 0}
        pageSize={PAGE_SIZE}
        patients={patients ?? []}
        linkedSessionCounts={linkedSessionCounts}
        packageBalances={packageBalanceMap}
        refunds={[...refundRowsById.values()].map((refund) => ({ ...refund, amount: Number(refund.amount), reversed: reversedRefundIds.has(refund.id) }))}
        paymentDueRows={paymentDueRows}
        billedThisMonth={billedThisMonth}
        billedLastMonth={billedLastMonth}
        billedLastMonthLabel={calendar.previousMonthLabel}
        currentMonthLabel={calendar.monthLabel}
        defaultPaymentDate={calendar.date}
        clinicToday={clinicToday}
        receivedThisMonth={receivedThisMonth}
        initialTab={initialTab}
        initialEntryOpen={newEntry === '1'}
      />
    </div>
  )
}
