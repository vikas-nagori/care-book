import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { isBalanceDetailPackage } from '@/lib/billing/package-progress'
import { PaymentDueDetail, type PaymentDuePackage, type PaymentDueSession } from './payment-due-detail'

// Drill-down behind a Payments Balance row: the sessions that tally to a patient's gross due, then
// the credit applied, then the net balance — the calculation made fully visible. Scheduled sessions
// are listed alongside completed ones because `patient_billing_balances_v2` sums appointment charges
// in both 'pending' (scheduled) and 'posted' (completed) states; omitting them made the tiles read
// higher than the list below could explain.
// Admin-only, mirroring the Billing page guard.
export default async function PaymentDueDetailPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params
  await requireAdmin()
  const supabase = await createClient()

  const [
    { data: patient },
    { data: sessions, error: sessionsError },
    { data: patientBalance, error: balanceError },
    { data: packageBalances, error: packageBalancesError },
    { data: packageRows, error: packagesError },
  ] =
    await Promise.all([
      supabase.from('patients').select('id, name').eq('id', patientId).maybeSingle(),
      supabase
        .from('appointments')
        .select('id, date, time, type, fee, status')
        .eq('patient_id', patientId)
        .in('status', ['scheduled', 'completed'])
        .in('payment_status', ['unpaid', 'partially_paid', 'partially_prepaid'])
        .order('date', { ascending: true })
        .order('time', { ascending: true }),
      supabase.from('patient_billing_balances_v2').select('*').eq('patient_id', patientId).maybeSingle(),
      supabase.from('package_billing_balances_v2').select('*').eq('patient_id', patientId),
      // `package_billing_balances_v2` carries every figure the card needs except the quoted session
      // count, which only lives on the packages row.
      supabase.from('packages').select('id, total_sessions, created_at').eq('patient_id', patientId),
    ])

  if (sessionsError) logger.error('PaymentDueDetail/sessions', sessionsError, { patientId })
  if (balanceError) logger.error('PaymentDueDetail/balance', balanceError, { patientId })
  if (packageBalancesError) logger.error('PaymentDueDetail/packageBalances', packageBalancesError, { patientId })
  if (packagesError) logger.error('PaymentDueDetail/packages', packagesError, { patientId })
  if (!patient) notFound()

  const toSession = (s: NonNullable<typeof sessions>[number]): PaymentDueSession => ({
    id: s.id,
    date: s.date,
    time: s.time,
    type: s.type,
    fee: Number(s.fee ?? 0),
  })
  const completedSessions = (sessions ?? []).filter((s) => s.status === 'completed').map(toSession)
  const scheduledSessions = (sessions ?? []).filter((s) => s.status === 'scheduled').map(toSession)

  const packageDue = (packageBalances ?? []).reduce((sum, balance) => sum + Number(balance.due_amount ?? 0), 0)
  const packageCredit = (packageBalances ?? []).reduce((sum, balance) => sum + Number(balance.refundable_credit ?? 0), 0)
  const ordinaryDue = Math.max(0, Number(patientBalance?.due_amount ?? 0) - packageDue)
  const ordinaryCredit = Math.max(0, Number(patientBalance?.refundable_credit ?? 0) - packageCredit)

  const packageMeta = new Map((packageRows ?? []).map((row) => [row.id, row]))
  const packages: PaymentDuePackage[] = (packageBalances ?? [])
    .filter((balance) => isBalanceDetailPackage({
      lifecycle: balance.lifecycle,
      dueAmount: Number(balance.due_amount ?? 0),
      refundableCredit: Number(balance.refundable_credit ?? 0),
    }))
    .map((balance) => ({
      id: balance.package_id,
      name: balance.name,
      status: balance.lifecycle,
      availedSessions: Number(balance.availed_sessions ?? 0),
      scheduledSessions: Number(balance.scheduled_sessions ?? 0),
      totalSessions: Number(packageMeta.get(balance.package_id)?.total_sessions ?? 0),
      quoteAmount: Number(balance.quote_amount ?? 0),
      netReceived: Number(balance.net_received ?? 0),
      dueAmount: Number(balance.due_amount ?? 0),
      refundableCredit: Number(balance.refundable_credit ?? 0),
    }))
    .sort((a, b) => {
      const aCreated = packageMeta.get(a.id)?.created_at ?? ''
      const bCreated = packageMeta.get(b.id)?.created_at ?? ''
      return bCreated.localeCompare(aCreated)
    })

  return (
    <PaymentDueDetail
      patientName={patient.name}
      sessions={completedSessions}
      scheduledSessions={scheduledSessions}
      packages={packages}
      ordinaryDue={ordinaryDue}
      ordinaryCredit={ordinaryCredit}
      packageDue={packageDue}
      packageCredit={packageCredit}
    />
  )
}
