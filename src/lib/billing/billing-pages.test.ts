import assert from 'node:assert/strict'
import test from 'node:test'

import {
  appendPaymentPage,
  atOrBeforeFilter,
  fetchPaymentPage,
  fetchPaymentsThrough,
  mergeRefunds,
  withLoadedRows,
  type BillingRefundRow,
} from './billing-pages.ts'
import type { BillingTimelinePayment } from './unified-billing.ts'

type Call = { table: string; ops: [string, unknown[]][] }

/** A chainable stand-in for the supabase-js query builder; `answer` decides each read's result. */
function fakeClient(answer: (call: Call) => { data: unknown[] | null; error: unknown }) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] }
      calls.push(call)
      const builder: Record<string, unknown> = {}
      for (const op of ['select', 'order', 'range', 'in', 'eq', 'or']) {
        builder[op] = (...args: unknown[]) => { call.ops.push([op, args]); return builder }
      }
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(answer(call)).then(resolve, reject)
      return builder
    },
  }
  return { client: client as unknown as Parameters<typeof fetchPaymentPage>[0], calls }
}

function payment(id: string, date = '2020-01-01'): BillingTimelinePayment {
  return {
    id, clinic_id: 'c', patient_id: 'p', package_id: null, appointment_id: null, amount: 100, payment_method: 'upi', date,
    notes: null, funding_scope: 'ordinary', status: 'posted', billing_version: 2, created_at: `${date}T00:00:00Z`,
    patient: { id: 'p', name: 'Test Patient' }, package: null,
  } as BillingTimelinePayment
}

function refund(id: string, paymentId: string): BillingRefundRow {
  return { id, payment_id: paymentId, amount: 10, refund_method: 'upi', refund_date: '2020-01-02', reason: 'r', reversed: false }
}

test('a "Load more" page brings its refunds, reversals and linked-session counts', async () => {
  const { client, calls } = fakeClient(({ table }) => {
    if (table === 'payments') return { data: [payment('pay-1'), payment('pay-2')], error: null }
    if (table === 'payment_applications') return { data: [{ payment_id: 'pay-1' }, { payment_id: 'pay-1' }], error: null }
    if (table === 'refunds') return { data: [{ ...refund('ref-1', 'pay-2'), amount: '10' }], error: null }
    return { data: [{ refund_id: 'ref-1' }], error: null }
  })
  const page = await fetchPaymentPage(client, 50, 50)
  assert.deepEqual(page.rows.map((row) => row.id), ['pay-1', 'pay-2'])
  assert.deepEqual(page.linkedSessionCounts, { 'pay-1': 2, 'pay-2': 0 })
  assert.deepEqual(page.refunds, [{ ...refund('ref-1', 'pay-2'), amount: 10, reversed: true }])

  const payments = calls.find((call) => call.table === 'payments')!
  assert.deepEqual(payments.ops.filter(([op]) => op === 'order').map(([, args]) => args[0]), ['date', 'id'], 'a total order: date, then id')
  assert.deepEqual(payments.ops.find(([op]) => op === 'range')?.[1], [50, 99])
})

test('a failed refunds read fails the whole page instead of showing receipts as never refunded (G-6)', async () => {
  const failure = { message: 'TypeError: Failed to fetch' }
  const { client } = fakeClient(({ table }) => {
    if (table === 'payments') return { data: [payment('pay-1')], error: null }
    if (table === 'refunds') return { data: null, error: failure }
    return { data: [], error: null }
  })
  await assert.rejects(fetchPaymentPage(client, 50, 50), (error) => error === failure)
})

test('a failed linked-sessions read fails the page too', async () => {
  const failure = { message: 'boom' }
  const { client } = fakeClient(({ table }) => {
    if (table === 'payments') return { data: [payment('pay-1')], error: null }
    if (table === 'payment_applications') return { data: null, error: failure }
    return { data: [], error: null }
  })
  await assert.rejects(fetchPaymentPage(client, 50, 50), (error) => error === failure)
})

test('the refresh re-read is bounded by the last loaded row and starts after the new first page', async () => {
  const { client, calls } = fakeClient(({ table }) => ({ data: table === 'payments' ? [payment('pay-9')] : [], error: null }))
  const page = await fetchPaymentsThrough(client, 50, payment('pay-last', '2019-05-06'))
  assert.deepEqual(page.rows.map((row) => row.id), ['pay-9'])
  const payments = calls.find((call) => call.table === 'payments')!
  assert.deepEqual(payments.ops.find(([op]) => op === 'or')?.[1], ['date.gt."2019-05-06",and(date.eq."2019-05-06",id.gte."pay-last")'])
  assert.deepEqual(payments.ops.find(([op]) => op === 'range')?.[1], [50, 1049])
})

test('atOrBeforeFilter quotes timestamps so their punctuation is not filter syntax', () => {
  assert.equal(
    atOrBeforeFilter('created_at', { value: '2016-01-01T00:00:00.5+00:00', id: 'a"b' }),
    'created_at.gt."2016-01-01T00:00:00.5+00:00",and(created_at.eq."2016-01-01T00:00:00.5+00:00",id.gte."ab")',
  )
})

test('the first page wins over loaded rows with the same id, and keeps its order', () => {
  const first = [payment('a'), payment('b')]
  const loaded = [{ ...payment('b'), amount: 999 }, payment('c')]
  assert.deepEqual(withLoadedRows(first, loaded).map((row) => [row.id, row.amount]), [['a', 100], ['b', 100], ['c', 100]])
})

test('server refunds win over loaded ones; loaded ones for other payments are kept', () => {
  const server = [{ ...refund('r1', 'p1'), reversed: true }]
  const loaded = [refund('r1', 'p1'), refund('r2', 'p9')]
  assert.deepEqual(mergeRefunds(server, loaded).map((row) => [row.id, row.reversed]), [['r1', true], ['r2', false]])
})

test('appending a page merges rows, counts and refunds', () => {
  const current = { rows: [payment('a')], linkedSessionCounts: { a: 1 }, refunds: [refund('r1', 'a')] }
  const next = { rows: [payment('b')], linkedSessionCounts: { b: 0 }, refunds: [refund('r2', 'b')] }
  const merged = appendPaymentPage(current, next)
  assert.deepEqual(merged.rows.map((row) => row.id), ['a', 'b'])
  assert.deepEqual(merged.linkedSessionCounts, { a: 1, b: 0 })
  assert.deepEqual(merged.refunds.map((row) => row.id), ['r1', 'r2'])
})
