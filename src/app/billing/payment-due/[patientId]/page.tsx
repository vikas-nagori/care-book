import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { PaymentDueDetail, type PaymentDueSession } from './payment-due-detail'

// Drill-down behind a Payments Balance row: the completed unpaid sessions that tally to a patient's
// gross due, then the credit applied, then the net balance — the calculation made fully visible.
// Admin-only, mirroring the Billing page guard.
export default async function PaymentDueDetailPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params
  await requireAdmin()
  const supabase = await createClient()

  const [{ data: patient }, { data: sessions, error: sessionsError }, { data: patientBalance, error: balanceError }, { data: packageBalances, error: packageBalancesError }] =
    await Promise.all([
      supabase.from('patients').select('id, name').eq('id', patientId).maybeSingle(),
      supabase
        .from('appointments')
        .select('id, date, time, type, fee')
        .eq('patient_id', patientId)
        .eq('status', 'completed')
        .in('payment_status', ['unpaid', 'partially_paid', 'partially_prepaid'])
        .order('date', { ascending: true })
        .order('time', { ascending: true }),
      supabase.from('patient_billing_balances_v2').select('*').eq('patient_id', patientId).maybeSingle(),
      supabase.from('package_billing_balances_v2').select('*').eq('patient_id', patientId),
    ])

  if (sessionsError) logger.error('PaymentDueDetail/sessions', sessionsError, { patientId })
  if (balanceError) logger.error('PaymentDueDetail/balance', balanceError, { patientId })
  if (packageBalancesError) logger.error('PaymentDueDetail/packageBalances', packageBalancesError, { patientId })
  if (!patient) notFound()

  const dueSessions: PaymentDueSession[] = (sessions ?? []).map((s) => ({
    id: s.id,
    date: s.date,
    time: s.time,
    type: s.type,
    fee: Number(s.fee ?? 0),
  }))

  const packageDue = (packageBalances ?? []).reduce((sum, balance) => sum + Number(balance.due_amount ?? 0), 0)
  const packageCredit = (packageBalances ?? []).reduce((sum, balance) => sum + Number(balance.refundable_credit ?? 0), 0)
  const ordinaryDue = Math.max(0, Number(patientBalance?.due_amount ?? 0) - packageDue)
  const ordinaryCredit = Math.max(0, Number(patientBalance?.refundable_credit ?? 0) - packageCredit)

  return (
    <PaymentDueDetail
      patientName={patient.name}
      sessions={dueSessions}
      ordinaryDue={ordinaryDue}
      ordinaryCredit={ordinaryCredit}
      packageDue={packageDue}
      packageCredit={packageCredit}
    />
  )
}
