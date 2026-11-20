import assert from 'node:assert/strict'
import test from 'node:test'
import { getExternalCalendarDay, getClinicBookingSlot } from './calendar.ts'
import { parseExternalBookingRequest, projectExternalAppointment, projectExternalWorkspace } from './workspace.ts'

const patient = {
  id: 'patient',
  name: 'Asha Patel',
  phone: '9876543210',
  dob: '1980-06-07',
  gender: null,
  email: null,
  address: 'Example address',
}
const appointment = {
  id: 'booking',
  patient_id: patient.id,
  patient_name: patient.name,
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
