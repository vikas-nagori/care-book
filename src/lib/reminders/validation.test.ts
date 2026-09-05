import assert from 'node:assert/strict'
import test from 'node:test'
import { isReminderId, validateReminderInput } from './validation.ts'

const patientId = '12cd4567-1234-4567-89ab-123456789abc'
test('minimal reminder normalizes optional fields and ignores ownership', () => {
  assert.deepEqual(validateReminderInput({ title: ' Call back ', date: '2026-09-05', clinic_id: 'bad', created_by: 'bad' }), {
    success: true, data: { title: 'Call back', date: '2026-09-05', time: null, patient_id: null, contact_name: null, phone: null, notes: null },
  })
})
test('normalizes populated reminder fields', () => {
  assert.deepEqual(validateReminderInput({ title: 'Call', date: '2024-02-29', time: '09:30', patientId, contactName: ' Sam ', phone: ' +91 123 ', notes: ' Check ' }), {
    success: true, data: { title: 'Call', date: '2024-02-29', time: '09:30', patient_id: patientId, contact_name: 'Sam', phone: '+91 123', notes: 'Check' },
  })
  assert.equal(validateReminderInput({ title: 'Call', date: '0001-01-01', patientId: ' ', time: '', contactName: null }).success, true)
})
test('rejects invalid shapes, dates, times, UUIDs and field lengths', () => {
  for (const input of [null, [], 'x', {}, { title: ' ', date: '2026-09-05' }, ...['2025-02-29', '2026-04-31', '0000-01-01', '10000-01-01', '2026-1-01', '2026-13-01'].map(date => ({title:'Call', date})), ...['24:00', '12:60', '1:00', '09:30:00'].map(time => ({title:'Call', date:'2026-09-05', time})), ...[{patientId:'nope'}, {title:'x'.repeat(201)}, {contactName:'x'.repeat(201)}, {phone:'x'.repeat(51)}, {notes:'x'.repeat(5001)}, {phone:123}, {time:123}].map(fields => ({title:'Call', date:'2026-09-05', ...fields}))]) {
    assert.equal(validateReminderInput(input).success, false, JSON.stringify(input))
  }
  for (const date of ['2000-02-29', '9999-12-31']) assert.equal(validateReminderInput({title:'Call',date}).success, true)
  assert.equal(validateReminderInput({title:'Call',date:'1900-02-29'}).success,false)
})
test('checks reminder identifiers without coercion', () => {
  assert.equal(isReminderId(patientId),true)
  for (const value of [null, {}, '', patientId + ' ', 'bad']) assert.equal(isReminderId(value),false)
})
