import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAppointmentTypeBreakdown, type BilledSession } from './appointment-type-breakdown.ts'

test('groups sessions by type, summing fees and counting sessions', () => {
  const sessions: BilledSession[] = [
    { type: 'clinic', fee: 800 },
    { type: 'home_visit', fee: 1000 },
    { type: 'clinic', fee: 800 },
  ]

  const rows = buildAppointmentTypeBreakdown(sessions)

  assert.deepEqual(rows, [
    { type: 'clinic', amount: 1600, count: 2 },
    { type: 'home_visit', amount: 1000, count: 1 },
  ])
})

test('sorts by amount descending, then by type name for ties', () => {
  const rows = buildAppointmentTypeBreakdown([
    { type: 'Alpha', fee: 500 },
    { type: 'Zeta', fee: 900 },
    { type: 'Beta', fee: 500 },
  ])

  assert.deepEqual(
    rows.map((r) => r.type),
    ['Zeta', 'Alpha', 'Beta'],
  )
})

test('counts zero-fee sessions but keeps their amount at 0', () => {
  const rows = buildAppointmentTypeBreakdown([
    { type: 'clinic', fee: 0 },
    { type: 'clinic', fee: 800 },
  ])

  assert.deepEqual(rows, [{ type: 'clinic', amount: 800, count: 2 }])
})

test('collapses blank, whitespace, and nullish types into a single "Untyped" bucket', () => {
  const rows = buildAppointmentTypeBreakdown([
    { type: null, fee: 100 },
    { type: undefined, fee: 100 },
    { type: '   ', fee: 100 },
    { type: '', fee: 100 },
  ])

  assert.deepEqual(rows, [{ type: 'Untyped', amount: 400, count: 4 }])
})

test('trims surrounding whitespace so " clinic " and "clinic" are the same bucket', () => {
  const rows = buildAppointmentTypeBreakdown([
    { type: ' clinic ', fee: 800 },
    { type: 'clinic', fee: 800 },
  ])

  assert.deepEqual(rows, [{ type: 'clinic', amount: 1600, count: 2 }])
})

test('treats null/non-finite fees as 0 without dropping the session', () => {
  const rows = buildAppointmentTypeBreakdown([
    { type: 'clinic', fee: null },
    { type: 'clinic', fee: Number.NaN },
    { type: 'clinic', fee: 800 },
  ])

  assert.deepEqual(rows, [{ type: 'clinic', amount: 800, count: 3 }])
})

test('the breakdown total always equals the sum of the source fees', () => {
  const sessions: BilledSession[] = [
    { type: 'clinic', fee: 800 },
    { type: 'home_visit', fee: 1000 },
    { type: null, fee: 250 },
    { type: 'clinic', fee: 0 },
  ]

  const total = buildAppointmentTypeBreakdown(sessions).reduce((sum, r) => sum + r.amount, 0)
  const expected = sessions.reduce((sum, s) => sum + Number(s.fee ?? 0), 0)

  assert.equal(total, expected)
})

test('returns an empty array for no sessions', () => {
  assert.deepEqual(buildAppointmentTypeBreakdown([]), [])
})
