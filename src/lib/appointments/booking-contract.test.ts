import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBookingRequest } from './booking-contract.ts'

const request = () => ({
  correlationId: '12345678-1234-4234-8234-123456789012',
  input: {
    patientId: '11111111-1111-4111-8111-111111111111', date: '2026-10-17', time: '15:00',
    durationMinutes: 45, appointmentTypeId: '22222222-2222-4222-8222-222222222222', fee: 500, notes: null,
  },
})

test('accepts a bounded booking and normalizes UUID case', () => {
  const value = request()
  value.correlationId = 'AB345678-1234-4234-8234-123456789012'
  const result = parseBookingRequest(value)
  assert.equal(result.success, true)
  if (result.success) assert.equal(result.request.correlationId, 'ab345678-1234-4234-8234-123456789012')
})

test('rejects malformed JSON types, invalid IDs, dates, times and unbounded recurrence before writes', () => {
  for (const mutation of [
    { durationMinutes: '45' }, { durationMinutes: 0 }, { durationMinutes: 1441 },
    { patientId: 'not-a-uuid' }, { date: '2026-02-30' }, { time: '24:30' },
    { fee: -1 }, { fee: Number.NaN }, { fee: 500.001 }, { notes: 'x'.repeat(10001) },
    { recurrence: { weekdays: [1], totalSessions: 101 } },
    { recurrence: { weekdays: ['1'], totalSessions: 3 } },
    { assignedTo: 'not-a-uuid' }, { appointmentTypeId: 123 },
    { newPatient: { name: 'Name', phone: '1234' } },
  ]) {
    assert.equal(parseBookingRequest({ ...request(), input: { ...request().input, ...mutation } }).success, false)
  }
  for (const value of [null, [], {}, { ...request(), correlationId: 'invalid' }]) {
    assert.equal(parseBookingRequest(value).success, false)
  }
})

test('requires one patient source and validates optional inline-patient fields', () => {
  const input: Omit<ReturnType<typeof request>['input'], 'patientId'> & { patientId?: string } = { ...request().input }
  delete input.patientId
  assert.equal(parseBookingRequest({ ...request(), input }).success, false)
  assert.equal(parseBookingRequest({ ...request(), input: { ...input, newPatient: { name: '', phone: '123' } } }).success, false)
  const newPatient = {
    name: ' Patient ', phone: ' 123 ', email: null, dob: null, gender: null, address: null,
    medical_history: null, notes: null, referral_source: null, referred_by_doctor_id: null,
    referred_by_patient_id: null, referral_other: null,
  }
  const result = parseBookingRequest({ ...request(), input: { ...input, newPatient } })
  assert.equal(result.success, true)
  if (result.success) assert.equal(result.request.input.newPatient?.name, 'Patient')
  assert.equal(parseBookingRequest({ ...request(), input: { ...input, newPatient: { ...newPatient, referral_source: 'invalid' } } }).success, false)
})
