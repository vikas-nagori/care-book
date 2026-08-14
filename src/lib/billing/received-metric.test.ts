import assert from 'node:assert/strict'
import test from 'node:test'
import { buildNetReceivedMetric } from './received-metric.ts'

test('net received excludes voided receipts and includes active refunds as negative records', () => {
  const result = buildNetReceivedMetric({
    payments: [
      { id: 'payment-posted', date: '2026-08-10', amount: 1000, payment_method: 'upi', status: 'posted', patientName: 'Smita' },
      { id: 'payment-voided', date: '2026-08-11', amount: 500, payment_method: 'cash', status: 'voided', patientName: 'Smita' },
    ],
    refunds: [
      { id: 'refund-active', refund_date: '2026-08-12', amount: 100, refund_method: 'upi', patientName: 'Smita' },
      { id: 'refund-reversed', refund_date: '2026-08-13', amount: 50, refund_method: 'cash', patientName: 'Smita' },
    ],
    reversedRefundIds: new Set(['refund-reversed']),
  })

  assert.equal(result.total, 900)
  assert.equal(result.rows.length, 2)
  assert.deepEqual(result.rows.map((row) => [row.id, row.amount]), [
    ['refund-refund-active', -100],
    ['payment-posted', 1000],
  ])
  assert.equal(result.rows[0].meta, 'UPI refund')
})

test('net received orders same-day records deterministically', () => {
  const result = buildNetReceivedMetric({
    payments: [
      { id: 'payment-b', date: '2026-08-10', amount: 200, payment_method: 'cash', status: 'posted', patientName: 'B' },
      { id: 'payment-a', date: '2026-08-10', amount: 100, payment_method: 'upi', status: 'posted', patientName: 'A' },
    ],
    refunds: [],
    reversedRefundIds: new Set(),
  })

  assert.deepEqual(result.rows.map((row) => row.id), ['payment-b', 'payment-a'])
})
