import assert from 'node:assert/strict'
import test from 'node:test'
import { createEventLimiter, parseClientEvent } from './client-events.ts'
const correlationId = '00000000-0000-4000-8000-000000000001'
test('only fixed operation names and UUID correlation reach telemetry', () => {
  assert.deepEqual(parseClientEvent({ operation: 'PatientForm/save', correlationId, message: 'private patient', path: '/patients/private' }), { operation: 'PatientForm/save', correlationId })
  for (const value of [null, {}, { operation: 'private patient', correlationId }, { operation: 'PatientForm/save', correlationId: 'patient-name' }]) {
    assert.equal(parseClientEvent(value), null)
  }
})
test('per-instance limiter bounds repeats, recovers after a minute and separates users', () => {
  const allow = createEventLimiter()
  for (let i = 0; i < 5; i++) assert.equal(allow('one', 100), true)
  assert.equal(allow('one', 101), false)
  assert.equal(allow('two', 101), true)
  assert.equal(allow('one', 60_101), true)
})

test('booking events preserve caller correlation and strip all unapproved fields', () => {
  assert.deepEqual(parseClientEvent({
    operation: 'AppointmentForm/booking', correlationId, phase: 'request', durationMs: 12,
    errorCode: '23503', patientId: 'private-id', name: 'Private Patient', input: { notes: 'Private note' },
  }), {
    operation: 'AppointmentForm/booking', correlationId, phase: 'request', durationMs: 12, errorCode: '23503',
  })
})

test('booking event validation rejects unapproved phases and invalid durations', () => {
  const base = { operation: 'AppointmentForm/booking', correlationId, phase: 'submit' }
  for (const value of [
    { ...base, phase: 'Private Patient' }, { ...base, correlationId: 'private-id' },
    ...[-1, Infinity, NaN, 0.5, 600_001, '12'].map(durationMs => ({ ...base, durationMs })),
  ]) assert.equal(parseClientEvent(value), null)
  assert.deepEqual(parseClientEvent({ ...base, durationMs: 0 }), { ...base, durationMs: 0 })
  assert.deepEqual(parseClientEvent({ ...base, durationMs: 600_000 }), { ...base, durationMs: 600_000 })
})

test('booking phases remain distinct and unsafe error text never reaches telemetry', () => {
  for (const phase of ['submit', 'request', 'confirmed', 'rejected', 'timeout', 'unconfirmed', 'status_check', 'retry', 'auto_retry', 'preparation_failed', 'options_failed']) {
    assert.deepEqual(parseClientEvent({ operation: 'AppointmentForm/booking', correlationId, phase, errorCode: 'Private Patient' }), {
      operation: 'AppointmentForm/booking', correlationId, phase,
    })
  }
  for (const errorCode of ['BOOKING_TIMEOUT', 'BOOKING_NOT_FOUND', 'PGRST116']) {
    assert.deepEqual(parseClientEvent({ operation: 'AppointmentForm/booking', correlationId, phase: 'unconfirmed', errorCode }), {
      operation: 'AppointmentForm/booking', correlationId, phase: 'unconfirmed', errorCode,
    })
  }
  for (const errorCode of ['ALICE', 'BOOKING_PRIVATE_PATIENT', '23503 Private Patient', { message: 'Private Patient' }]) {
    assert.deepEqual(parseClientEvent({ operation: 'AppointmentForm/booking', correlationId, phase: 'rejected', errorCode }), {
      operation: 'AppointmentForm/booking', correlationId, phase: 'rejected',
    })
  }
})

test('a booking limiter supports several staged attempts without changing the legacy bound', () => {
  const allow = createEventLimiter(60)
  for (let i = 0; i < 60; i++) assert.equal(allow('one', 100), true)
  assert.equal(allow('one', 101), false)
  assert.equal(allow('two', 101), true)
  assert.equal(allow('one', 60_100), true)
})
