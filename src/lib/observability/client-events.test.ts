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
