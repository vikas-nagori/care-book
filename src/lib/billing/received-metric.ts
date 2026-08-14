export type ReceivedMetricRow = {
  id: string
  date: string
  title: string
  meta: string
  amount: number
}

type PaymentRecord = {
  id: string
  date: string
  amount: number | string
  payment_method: string | null
  status: string
  patientName: string
}

type RefundRecord = {
  id: string
  refund_date: string
  amount: number | string
  refund_method: string
  patientName: string
}

export function buildNetReceivedMetric({
  payments,
  refunds,
  reversedRefundIds,
}: {
  payments: PaymentRecord[]
  refunds: RefundRecord[]
  reversedRefundIds: ReadonlySet<string>
}) {
  const rows: ReceivedMetricRow[] = []

  for (const payment of payments) {
    if (payment.status !== 'posted') continue
    rows.push({
      id: payment.id,
      date: payment.date,
      title: payment.patientName,
      meta: payment.payment_method ?? 'Payment',
      amount: Number(payment.amount),
    })
  }

  for (const refund of refunds) {
    if (reversedRefundIds.has(refund.id)) continue
    rows.push({
      id: `refund-${refund.id}`,
      date: refund.refund_date,
      title: refund.patientName,
      meta: `${refund.refund_method.toUpperCase()} refund`,
      amount: -Number(refund.amount),
    })
  }

  rows.sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id))
  return { rows, total: rows.reduce((sum, row) => sum + row.amount, 0) }
}
