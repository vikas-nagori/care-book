import assert from 'node:assert/strict'
import test from 'node:test'
import { billedTotalForMonth, countLinkedSessions, monthKeyOf } from './billing-overview-totals.ts'

test('monthKeyOf takes the YYYY-MM of a calendar date', () => {
  assert.equal(monthKeyOf('2026-11-01'), '2026-11')
  assert.equal(monthKeyOf('2026-01-31'), '2026-01')
  assert.throws(() => monthKeyOf('11/2026'), /YYYY-MM-DD/)
})

test('billedTotalForMonth sums every appointment type in the month and nothing else', () => {
  const rows = [
    { month: '2026-11', appointment_type: 'Clinic', amount: '1200.00', session_count: 3 },
    { month: '2026-11', appointment_type: 'Home', amount: 1500, session_count: '2' },
    { month: '2026-10', appointment_type: 'Clinic', amount: '999.50', session_count: 4 },
    { month: '2026-12', appointment_type: 'Clinic', amount: '50', session_count: 1 },
  ]
  assert.equal(billedTotalForMonth(rows, '2026-11'), 2700)
  assert.equal(billedTotalForMonth(rows, '2026-10'), 999.5)
  assert.equal(billedTotalForMonth(rows, '2026-09'), 0)
})

test('billedTotalForMonth treats missing or blank amounts as zero, like the old per-session sum', () => {
  assert.equal(billedTotalForMonth([{ month: '2026-11', appointment_type: 'Untyped', amount: null, session_count: 1 }], '2026-11'), 0)
  assert.equal(billedTotalForMonth([], '2026-11'), 0)
})

test('billedTotalForMonth rejects a non-numeric amount instead of silently dropping it', () => {
  assert.throws(
    () => billedTotalForMonth([{ month: '2026-11', appointment_type: 'Clinic', amount: 'abc', session_count: 1 }], '2026-11'),
    /amount/,
  )
})

test('countLinkedSessions counts active applications per payment', () => {
  assert.deepEqual(
    countLinkedSessions([{ payment_id: 'a' }, { payment_id: 'b' }, { payment_id: 'a' }]),
    { a: 2, b: 1 },
  )
  assert.deepEqual(countLinkedSessions([]), {})
})
