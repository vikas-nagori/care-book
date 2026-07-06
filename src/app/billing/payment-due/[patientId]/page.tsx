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

  const [{ data: patient }, { data: sessions, error: sessionsError }, { data: payments }, { data: appointmentPayments }] =
    await Promise.all([
      supabase.from('patients').select('id, name').eq('id', patientId).maybeSingle(),
      supabase
        .from('appointments')
        .select('id, date, time, type, fee')
        .eq('patient_id', patientId)
        .eq('status', 'completed')
        .eq('payment_status', 'unpaid')
        .order('date', { ascending: true })
        .order('time', { ascending: true }),
      supabase.from('payments').select('amount').eq('patient_id', patientId),
      // amount_applied across this patient's payments (inner join filters to the patient).
      supabase
        .from('appointment_payments')
        .select('amount_applied, payment:payments!inner(patient_id)')
        .eq('payment.patient_id', patientId),
    ])

  if (sessionsError) logger.error('PaymentDueDetail/sessions', sessionsError, { patientId })
  if (!patient) notFound()

  const dueSessions: PaymentDueSession[] = (sessions ?? []).map((s) => ({
    id: s.id,
    date: s.date,
    time: s.time,
    type: s.type,
    fee: Number(s.fee ?? 0),
  }))

  const grossDue = dueSessions.reduce((sum, s) => sum + s.fee, 0)
  const totalPaid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount ?? 0), 0)
  const appliedTotal = (appointmentPayments ?? []).reduce((sum, r) => sum + Number(r.amount_applied ?? 0), 0)
  const unspentCredit = Math.max(0, totalPaid - appliedTotal)
  const netDue = Math.max(0, grossDue - unspentCredit)
  const netCredit = Math.max(0, unspentCredit - grossDue)

  return (
    <PaymentDueDetail
      patientName={patient.name}
      sessions={dueSessions}
      grossDue={grossDue}
      unspentCredit={unspentCredit}
      netDue={netDue}
      netCredit={netCredit}
    />
  )
}
