import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAppointmentInsertRows } from './appointment-creation.ts'

const baseInput = {
  patientId: 'patient-1',
  date: '2026-07-20',
  time: '09:00',
  durationMinutes: 45,
  appointmentTypeId: 'type-1',
  fee: 800,
  assignedTo: 'staff-1',
  externalStaffId: null,
  notes: 'Continue exercises',
}

test('builds one scheduled appointment when recurrence is disabled', () => {
  assert.deepEqual(buildAppointmentInsertRows(baseInput), [
    {
      patient_id: 'patient-1',
      date: '2026-07-20',
      time: '09:00',
      duration_minutes: 45,
      appointment_type_id: 'type-1',
      status: 'scheduled',
      fee: 800,
      assigned_to: 'staff-1',
      external_staff_id: null,
      notes: 'Continue exercises',
    },
  ])
})

test('copies all appointment details to every generated recurring date', () => {
  const rows = buildAppointmentInsertRows({
    ...baseInput,
    fee: 0,
    assignedTo: null,
    externalStaffId: 'external-1',
    recurrence: { weekdays: [1, 4], totalSessions: 4 },
  })

  assert.deepEqual(rows.map((row) => row.date), [
    '2026-07-20',
    '2026-07-23',
    '2026-07-27',
    '2026-07-30',
  ])
  assert.ok(rows.every((row) => row.fee === 0))
  assert.ok(rows.every((row) => row.assigned_to === null))
  assert.ok(rows.every((row) => row.external_staff_id === 'external-1'))
  assert.ok(rows.every((row) => row.status === 'scheduled'))
})

test('preserves a null fee and applies the default duration', () => {
  const [row] = buildAppointmentInsertRows({
    ...baseInput,
    durationMinutes: 0,
    fee: null,
  })

  assert.equal(row.duration_minutes, 45)
  assert.equal(row.fee, null)
})
