import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAppointmentFee } from './appointment-fee.ts'

test('an explicit fee always wins', () => {
  assert.deepEqual(resolveAppointmentFee(1200, 650), { kind: 'resolved', fee: 1200 })
})

test('an explicit zero fee books a free session deliberately', () => {
  assert.deepEqual(resolveAppointmentFee(0, 650), { kind: 'resolved', fee: 0 })
})

test('the appointment type session rate is the default', () => {
  assert.deepEqual(resolveAppointmentFee(undefined, 1500), { kind: 'resolved', fee: 1500 })
})

test('a missing rate asks instead of writing an unpriced session', () => {
  // A null fee reaches the ledger as coalesce(fee, 0), and migration 039 stamps a zero-value
  // charge 'paid' — so an unpriced booking would silently become a settled free session.
  assert.deepEqual(resolveAppointmentFee(undefined, null), { kind: 'needs_fee', defaultRate: null })
})

test('a zero session rate asks rather than assuming a free session', () => {
  assert.deepEqual(resolveAppointmentFee(undefined, 0), { kind: 'needs_fee', defaultRate: 0 })
})

test('non-numeric and negative fees fall back to the type rate', () => {
  assert.deepEqual(resolveAppointmentFee('650', 900), { kind: 'resolved', fee: 900 })
  assert.deepEqual(resolveAppointmentFee(-50, 900), { kind: 'resolved', fee: 900 })
  assert.deepEqual(resolveAppointmentFee(Number.NaN, 900), { kind: 'resolved', fee: 900 })
})
