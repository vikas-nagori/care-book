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

export type PaymentDueRow = {
  patientId: string
  patientName: string
  unpaidSessionCount: number
  grossDue: number
  unspentCredit: number
  netDue: number
  oldestDueDate: string
  latestDueDate: string
}

export function buildPaymentDueRows({
  appointments,
  payments,
  appointmentPayments,
}: {
  appointments: PaymentDueAppointment[]
  payments: PaymentDuePayment[]
  appointmentPayments: PaymentDueAppointmentPayment[]
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

  const dueByPatient = appointments.reduce<Record<string, Omit<PaymentDueRow, 'unspentCredit' | 'netDue'>>>(
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

  return Object.values(dueByPatient)
    .map((row) => {
      const unspentCredit = creditByPatient[row.patientId] ?? 0
      return {
        ...row,
        unspentCredit,
        netDue: Math.max(0, row.grossDue - unspentCredit),
      }
    })
    .filter((row) => row.netDue > 0)
    .sort((left, right) => right.netDue - left.netDue || left.patientName.localeCompare(right.patientName))
}
