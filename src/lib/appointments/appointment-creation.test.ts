import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAppointmentInsertRows, resolveAppointmentStatus } from './appointment-creation.ts'

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
  today: '2026-07-20',
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

test('creates a backdated appointment as completed', () => {
  const [row] = buildAppointmentInsertRows({ ...baseInput, date: '2026-07-18', today: '2026-07-20' })

  assert.equal(row.status, 'completed')
})

test('leaves an appointment booked for today as scheduled', () => {
  const [row] = buildAppointmentInsertRows({ ...baseInput, date: '2026-07-20', today: '2026-07-20' })

  assert.equal(row.status, 'scheduled')
})

test('splits a recurrence that starts in the past into completed and scheduled rows', () => {
  const rows = buildAppointmentInsertRows({
    ...baseInput,
    date: '2026-07-13',
    today: '2026-07-20',
    recurrence: { weekdays: [1], totalSessions: 3 },
  })

  assert.deepEqual(
    rows.map((row) => [row.date, row.status]),
    [
      ['2026-07-13', 'completed'],
      ['2026-07-20', 'scheduled'],
      ['2026-07-27', 'scheduled'],
    ],
  )
})

test('resolveAppointmentStatus compares calendar dates, not clock time', () => {
  assert.equal(resolveAppointmentStatus('2026-07-19', '2026-07-20'), 'completed')
  assert.equal(resolveAppointmentStatus('2026-07-20', '2026-07-20'), 'scheduled')
  assert.equal(resolveAppointmentStatus('2026-07-21', '2026-07-20'), 'scheduled')
  assert.equal(resolveAppointmentStatus('2025-12-31', '2026-01-01'), 'completed')
})
