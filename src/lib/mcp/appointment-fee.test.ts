import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAppointmentFee } from './appointment-fee.ts'

const inputs = (overrides: Partial<Parameters<typeof resolveAppointmentFee>[0]> = {}) => ({
  explicitFee: undefined,
  lastPatientFee: null,
  sessionRate: null,
  ...overrides,
})

test('an explicit fee always wins', () => {
  assert.deepEqual(resolveAppointmentFee(inputs({ explicitFee: 1200, lastPatientFee: 1500, sessionRate: 650 })), {
    kind: 'resolved',
    fee: 1200,
    source: 'provided',
  })
})

test('an explicit zero fee books a free session deliberately', () => {
  assert.deepEqual(resolveAppointmentFee(inputs({ explicitFee: 0, sessionRate: 650 })), {
    kind: 'resolved',
    fee: 0,
    source: 'provided',
  })
})

test("the patient's own last fee outranks the appointment type default", () => {
  // Aadi is billed 1500 for a home visit while the type default is 1000. Falling back to the type
  // rate would undercharge him by 500 on every booking.
  assert.deepEqual(resolveAppointmentFee(inputs({ lastPatientFee: 1500, sessionRate: 1000 })), {
    kind: 'resolved',
    fee: 1500,
    source: 'patient_history',
  })
})

test('the appointment type rate is used when the patient has no history', () => {
  assert.deepEqual(resolveAppointmentFee(inputs({ lastPatientFee: null, sessionRate: 650 })), {
    kind: 'resolved',
    fee: 650,
    source: 'appointment_type',
  })
})

test('no history and no rate asks instead of writing an unpriced session', () => {
  // A null fee reaches the ledger as coalesce(fee, 0), and migration 039 stamps a zero-value
  // charge 'paid' — so an unpriced booking would silently become a settled free session.
  assert.deepEqual(resolveAppointmentFee(inputs()), { kind: 'needs_fee', defaultRate: null })
})

test('a zero type rate with no history asks rather than assuming a free session', () => {
  assert.deepEqual(resolveAppointmentFee(inputs({ sessionRate: 0 })), { kind: 'needs_fee', defaultRate: 0 })
})

test('a zero or negative historical fee is not treated as an agreed rate', () => {
  assert.deepEqual(resolveAppointmentFee(inputs({ lastPatientFee: 0, sessionRate: 900 })), {
    kind: 'resolved',
    fee: 900,
    source: 'appointment_type',
  })
})

test('non-numeric and negative explicit fees fall through to the other sources', () => {
  assert.equal(resolveAppointmentFee(inputs({ explicitFee: '650', sessionRate: 900 })).kind, 'resolved')
  assert.deepEqual(resolveAppointmentFee(inputs({ explicitFee: -50, sessionRate: 900 })), {
    kind: 'resolved',
    fee: 900,
    source: 'appointment_type',
  })
  assert.deepEqual(resolveAppointmentFee(inputs({ explicitFee: Number.NaN, sessionRate: 900 })), {
    kind: 'resolved',
    fee: 900,
    source: 'appointment_type',
  })
})
