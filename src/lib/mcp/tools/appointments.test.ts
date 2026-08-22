import assert from 'node:assert/strict'
import test from 'node:test'

import { appointmentPublicView, normalizeAppointmentSelector } from '../appointment-output.ts'

test('appointment selectors normalize date/time/name without exposing an id', () => {
  assert.deepEqual(normalizeAppointmentSelector({
    date: ' 2026-08-22 ',
    time: '09:30',
    patient_name: '  Ada Lovelace ',
  }), {
    date: '2026-08-22',
    time: '09:30',
    patientName: 'Ada Lovelace',
  })
})

test('public appointment views omit identifiers and billing signals', () => {
  const view = appointmentPublicView({
    id: 'appointment-secret',
    patient_id: 'patient-secret',
    clinic_id: 'clinic-secret',
    date: '2026-08-22',
    time: '09:30:00',
    duration_minutes: 45,
    type: 'Clinic',
    type_is_shared: true,
    status: 'scheduled',
    fee: 800,
    payment_status: 'unpaid',
    notes: 'Bring band',
    patient: { name: 'Ada Lovelace', phone: '9999999999' },
    assignee: null,
    external_staff: null,
  }, 'selection-token')

  assert.deepEqual(view, {
    appointment_selection_token: 'selection-token',
    patient_name: 'Ada Lovelace',
    patient_phone: '9999999999',
    date: '2026-08-22',
    time: '09:30:00',
    duration_minutes: 45,
    appointment_type: 'Clinic',
    status: 'scheduled',
    notes: 'Bring band',
  })
  assert.equal('id' in view, false)
  assert.equal('fee' in view, false)
  assert.equal('payment_status' in view, false)
})
