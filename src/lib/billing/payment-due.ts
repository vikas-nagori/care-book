export type PaymentDueAppointment = {
  id: string
  patient_id: string
  date: string
  status: 'scheduled' | 'completed' | 'cancelled'
  payment_status: 'unpaid' | 'prepaid' | 'paid'
  fee: number | null
  patient?: { id: string; name: string } | null
}

export type PaymentDuePayment = {
  id: string
  patient_id: string
  amount: number | null
}

export type PaymentDueAppointmentPayment = {
  payment_id: string
  amount_applied: number | null
}

export type PaymentBalanceDirection = 'due' | 'credit'

export type PaymentDueRow = {
  patientId: string
  patientName: string
  unpaidSessionCount: number
  grossDue: number
  unspentCredit: number
  netDue: number
  /** Overpayment left after covering gross due — the mirror of netDue. */
  netCredit: number
  /** Which side of zero this patient's balance sits on. */
  direction: PaymentBalanceDirection
  oldestDueDate: string
  latestDueDate: string
}

export function buildPaymentDueRows({
  appointments,
  payments,
  appointmentPayments,
  patientNames,
}: {
  appointments: PaymentDueAppointment[]
  payments: PaymentDuePayment[]
  appointmentPayments: PaymentDueAppointmentPayment[]
  /** Names for credit-only patients that have no completed unpaid session to source a name from. */
  patientNames?: Record<string, string>
}): PaymentDueRow[] {
  const appliedByPayment = appointmentPayments.reduce<Record<string, number>>((totals, row) => {
    totals[row.payment_id] = (totals[row.payment_id] ?? 0) + Number(row.amount_applied ?? 0)
    return totals
  }, {})

  const creditByPatient = payments.reduce<Record<string, number>>((credit, payment) => {
    const unspent = Math.max(0, Number(payment.amount ?? 0) - (appliedByPayment[payment.id] ?? 0))
    credit[payment.patient_id] = (credit[payment.patient_id] ?? 0) + unspent
    return credit
  }, {})

  const dueByPatient = appointments.reduce<
    Record<string, Omit<PaymentDueRow, 'unspentCredit' | 'netDue' | 'netCredit' | 'direction'>>
  >(
    (rows, appointment) => {
      if (appointment.status !== 'completed') return rows
      if (appointment.payment_status !== 'unpaid') return rows

      const fee = Number(appointment.fee ?? 0)
      if (!Number.isFinite(fee) || fee <= 0) return rows

      const current = rows[appointment.patient_id]
      const patientName = appointment.patient?.name ?? 'Unknown patient'

      if (!current) {
        rows[appointment.patient_id] = {
          patientId: appointment.patient_id,
          patientName,
          unpaidSessionCount: 1,
          grossDue: fee,
          oldestDueDate: appointment.date,
          latestDueDate: appointment.date,
        }
        return rows
      }

      current.unpaidSessionCount += 1
      current.grossDue += fee
      if (appointment.date < current.oldestDueDate) current.oldestDueDate = appointment.date
      if (appointment.date > current.latestDueDate) current.latestDueDate = appointment.date
      return rows
    },
    {},
  )

  // Union of patients that either owe money or hold unspent credit. A patient with only credit
  // (no completed unpaid session) has no dueByPatient entry, so pull their name from patientNames.
  const patientIds = new Set<string>([...Object.keys(dueByPatient), ...Object.keys(creditByPatient)])

  return Array.from(patientIds)
    .map((patientId): PaymentDueRow => {
      const due = dueByPatient[patientId]
      const grossDue = due?.grossDue ?? 0
      const unspentCredit = creditByPatient[patientId] ?? 0
      const netDue = Math.max(0, grossDue - unspentCredit)
      const netCredit = Math.max(0, unspentCredit - grossDue)
      return {
        patientId,
        patientName: due?.patientName ?? patientNames?.[patientId] ?? 'Unknown patient',
        unpaidSessionCount: due?.unpaidSessionCount ?? 0,
        grossDue,
        unspentCredit,
        netDue,
        netCredit,
        direction: netCredit > 0 ? 'credit' : 'due',
        oldestDueDate: due?.oldestDueDate ?? '',
        latestDueDate: due?.latestDueDate ?? '',
      }
    })
    // Drop fully settled patients (gross exactly covered by credit — nothing to show either way).
    .filter((row) => row.netDue > 0 || row.netCredit > 0)
    // Owing patients first (largest due), then credit balances (largest credit), then by name.
    .sort(
      (left, right) =>
        Number(right.direction === 'due') - Number(left.direction === 'due') ||
        right.netDue - left.netDue ||
        right.netCredit - left.netCredit ||
        left.patientName.localeCompare(right.patientName),
    )
}
