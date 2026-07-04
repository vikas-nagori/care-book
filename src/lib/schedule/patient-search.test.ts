import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPatientInsertData,
  createPatientDraftFromName,
  filterAppointmentPatientOptions,
  shouldOfferCreatePatientOption,
  type AppointmentPatientOption,
} from './patient-search.ts'

const patientOptions: AppointmentPatientOption[] = [
  { id: 'patient-1', name: 'Asha Patel' },
  { id: 'patient-2', name: 'Rohan Mehta' },
  { id: 'patient-3', name: 'Anaya Shah' },
]

test('filterAppointmentPatientOptions matches patient names case-insensitively', () => {
  const result = filterAppointmentPatientOptions(patientOptions, 'sha')

  assert.deepEqual(result.map((patient) => patient.id), ['patient-1', 'patient-3'])
})

test('filterAppointmentPatientOptions returns all patients when the query is blank', () => {
  const result = filterAppointmentPatientOptions(patientOptions, '   ')

  assert.strictEqual(result, patientOptions)
})

test('filterAppointmentPatientOptions trims the query before matching names', () => {
  const result = filterAppointmentPatientOptions(patientOptions, '  rohan  ')

  assert.deepEqual(result.map((patient) => patient.id), ['patient-2'])
})

test('shouldOfferCreatePatientOption returns false when the typed name exactly matches an existing patient', () => {
  assert.equal(shouldOfferCreatePatientOption(patientOptions, '  asha patel  '), false)
})

test('shouldOfferCreatePatientOption returns false for a blank typed name', () => {
  assert.equal(shouldOfferCreatePatientOption(patientOptions, '   '), false)
})

test('shouldOfferCreatePatientOption returns true when the typed name is new', () => {
  assert.equal(shouldOfferCreatePatientOption(patientOptions, 'Neha Joshi'), true)
})

test('createPatientDraftFromName pre-fills the typed name and clears the remaining patient fields', () => {
  assert.deepEqual(createPatientDraftFromName('  Neha Joshi '), {
    name: 'Neha Joshi',
    phone: '',
    email: '',
    dob: '',
    gender: '',
    address: '',
    medical_history: '',
    notes: '',
  })
})

test('buildPatientInsertData trims fields and converts blank optional values to null', () => {
  assert.deepEqual(buildPatientInsertData({
    name: '  Neha Joshi ',
    phone: ' 9876543210 ',
    email: ' ',
    dob: '',
    gender: 'female',
    address: '  Pune ',
    medical_history: '',
    notes: ' First visit ',
  }), {
    name: 'Neha Joshi',
    phone: '9876543210',
    email: null,
    dob: null,
    gender: 'female',
    address: 'Pune',
    medical_history: null,
    notes: 'First visit',
  })
})
