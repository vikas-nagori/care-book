import assert from 'node:assert/strict'
import test from 'node:test'
import { getExternalCalendarDay, getClinicBookingSlot } from './calendar.ts'
import {
  parseExternalAppointmentUpdate, parseExternalBookingRequest, projectExternalAppointment, projectExternalWorkspace,
} from './workspace.ts'

const patient = {
  id: 'patient',
  name: 'Asha Patel',
  phone: '9876543210',
  dob: '1980-06-07',
  age_years: null,
  age_recorded_on: null,
  gender: null,
  email: null,
  address: 'Example address',
}
const appointment = {
  id: 'booking',
  patient_id: patient.id,
  patient_name: patient.name,
  appointment_type_id: 'clinic',
  date: '2026-11-21',
  time: '08:15:00',
  duration_minutes: 30,
  type: 'Clinic visit',
  status: 'scheduled',
}
const type = { id: 'clinic', name: 'Clinic visit' }

test('projects only the external patient, booking and appointment-type fields', () => {
  assert.deepEqual(projectExternalWorkspace({
    patients: [{ ...patient, medical_history: 'private' }],
    appointments: [{ ...appointment, notes: 'private', fee: 1000 }],
    appointment_types: [{ ...type, fee: 1000 }],
    total_clinic_appointments: 42,
  }), { patients: [patient], appointments: [appointment], appointment_types: [type] })
})

test('rejects malformed RPC payloads rather than rendering a partial workspace', () => {
  assert.equal(projectExternalWorkspace({
    patients: [patient],
    appointments: [{ ...appointment, patient_name: null }],
    appointment_types: [type],
  }), null)
})

test('a shared patient carries an entered age, and a database without the age columns reads as unknown', () => {
  const aged = { ...patient, dob: null, age_years: 46, age_recorded_on: '2026-11-24' }
  assert.deepEqual(projectExternalWorkspace({ patients: [aged], appointments: [], appointment_types: [] }),
    { patients: [aged], appointments: [], appointment_types: [] })
  const legacy: Record<string, unknown> = { ...patient }
  delete legacy.age_years
  delete legacy.age_recorded_on
  assert.deepEqual(projectExternalWorkspace({ patients: [legacy], appointments: [], appointment_types: [] }),
    { patients: [patient], appointments: [], appointment_types: [] })
  for (const bad of [{ age_years: -1 }, { age_years: 4.5 }, { age_years: '46' }, { age_recorded_on: '24-11-2026' }]) {
    assert.equal(projectExternalWorkspace({ patients: [{ ...aged, ...bad }], appointments: [], appointment_types: [] }), null)
  }
})

test('an admin-set duration beyond the booking limit still displays instead of hiding the calendar', () => {
  const long = { ...appointment, duration_minutes: 1500 }
  assert.deepEqual(projectExternalWorkspace({ patients: [patient], appointments: [long], appointment_types: [type] }),
    { patients: [patient], appointments: [long], appointment_types: [type] })
  assert.equal(projectExternalAppointment({ ...appointment, duration_minutes: 0 }), null)
  assert.equal(projectExternalAppointment({ ...appointment, duration_minutes: 1.5 }), null)
})

test('the booking response excludes creator, assignee and rate even if present', () => {
  assert.deepEqual(projectExternalAppointment({
    ...appointment, fee: 1000, created_by: 'private', external_profile_id: 'private',
  }), appointment)
})

test('the booking payload retains a caller retry reference and rejects any unexpected field', () => {
  const request = {
    id: '00000000-0000-4000-8000-000000000001',
    patient_id: '00000000-0000-4000-8000-000000000002',
    appointment_type_id: '00000000-0000-4000-8000-000000000003',
    date: '2026-11-21',
    time: '09:15',
    duration_minutes: 45,
  }
  assert.deepEqual(parseExternalBookingRequest(request), request)
  assert.equal(parseExternalBookingRequest({ ...request, fee: 1000 }), null)
  assert.equal(parseExternalBookingRequest({ ...request, date: '2026-02-30' }), null)
  assert.equal(parseExternalBookingRequest({ ...request, duration_minutes: 1441 }), null)
})

test('an appointment without its type id is malformed, since the reschedule form needs it', () => {
  const withoutType: Record<string, unknown> = { ...appointment }
  delete withoutType.appointment_type_id
  assert.equal(projectExternalAppointment(withoutType), null)
  assert.equal(projectExternalAppointment({ ...appointment, appointment_type_id: null }), null)
})

test('the update payload accepts a reschedule or a cancellation and rejects anything else', () => {
  const update = {
    id: '00000000-0000-4000-8000-000000000001',
    appointment_type_id: '00000000-0000-4000-8000-000000000003',
    date: '2026-11-21',
    time: '09:15:00',
    duration_minutes: 45,
    status: 'scheduled',
  }
  assert.deepEqual(parseExternalAppointmentUpdate(update), update)
  assert.deepEqual(parseExternalAppointmentUpdate({ ...update, status: 'cancelled' }), { ...update, status: 'cancelled' })
  const missing: Record<string, unknown> = { ...update }
  delete missing.status
  for (const invalid of [
    missing, { ...update, fee: 1000 }, { ...update, patient_id: update.id }, { ...update, status: 'completed' },
    { ...update, id: 'booking' }, { ...update, appointment_type_id: 'clinic' }, { ...update, date: '2026-02-30' },
    { ...update, time: '24:00' }, { ...update, time: '09:15:30' }, { ...update, duration_minutes: 0 },
    { ...update, duration_minutes: 1441 }, { ...update, duration_minutes: '45' }, null, [update],
  ]) {
    assert.equal(parseExternalAppointmentUpdate(invalid), null)
  }
})

test('a local calendar day queries both relevant clinic dates and filters adjoining bookings', () => {
  const day = getExternalCalendarDay('2026-11-20', new Date('2026-11-21T00:00:00Z'), 'America/New_York')
  assert.deepEqual(day.clinicDates, { startDate: '2026-11-20', endDate: '2026-11-21' })
  assert.equal(day.start.toISOString(), '2026-11-20T05:00:00.000Z')
  assert.equal(day.end.toISOString(), '2026-11-21T05:00:00.000Z')
})

test('booking a local time converts to its clinic date without losing the day boundary', () => {
  assert.deepEqual(getClinicBookingSlot('2026-11-20', '21:15', 'America/New_York'), {
    date: '2026-11-21', time: '07:45',
  })
})

test('booking rejects a local time skipped by a daylight-saving transition', () => {
  assert.equal(getClinicBookingSlot('2026-03-08', '02:30', 'America/New_York'), null)
})
