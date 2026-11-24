import { addCalendarDays } from '../timezone.ts'
import type {
  ExternalAppointment, ExternalAppointmentType, ExternalAppointmentUpdate, ExternalBookingRequest, ExternalPatient, ExternalWorkspace,
} from './types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BOOKING_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/
const DISPLAY_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/

export const EXTERNAL_ACCESS_MESSAGE = 'Your access may have changed. If you need access, contact your clinic admin.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isExternalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false

  try {
    return addCalendarDays(value, 0) === value
  } catch {
    return false
  }
}

function isOptionalText(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

// Display accepts whatever the database allows (duration_minutes > 0): an admin can set a
// longer appointment, and one such row must not make the whole workspace unavailable.
function isDisplayDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function isBookingDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1440
}

function projectPatient(value: unknown): ExternalPatient | null {
  if (!isRecord(value)) return null
  const { id, name, phone, dob, gender, email, address } = value
  // Absent (not just null) until the patient-age migration is applied, so treat missing as unknown.
  const age_years = value.age_years ?? null
  const age_recorded_on = value.age_recorded_on ?? null
  if (typeof id !== 'string' || typeof name !== 'string') return null
  if (!isOptionalText(phone) || (dob !== null && !isExternalDate(dob))) return null
  if (age_years !== null && !(typeof age_years === 'number' && Number.isInteger(age_years) && age_years >= 0)) return null
  if (age_recorded_on !== null && !isExternalDate(age_recorded_on)) return null
  if (!isOptionalText(gender) || !isOptionalText(email) || !isOptionalText(address)) return null
  return { id, name, phone, dob, age_years, age_recorded_on, gender, email, address }
}

export function projectExternalAppointment(value: unknown): ExternalAppointment | null {
  if (!isRecord(value)) return null
  const { id, patient_id, patient_name, appointment_type_id, date, time, duration_minutes, type, status } = value
  if (typeof id !== 'string' || typeof patient_id !== 'string' || typeof patient_name !== 'string' || typeof type !== 'string') return null
  if (typeof appointment_type_id !== 'string') return null
  if (!isExternalDate(date) || typeof time !== 'string' || !DISPLAY_TIME.test(time) || !isDisplayDuration(duration_minutes)) return null
  if (status !== 'scheduled' && status !== 'completed' && status !== 'cancelled') return null
  return { id, patient_id, patient_name, appointment_type_id, date, time, duration_minutes, type, status }
}

function projectAppointmentType(value: unknown): ExternalAppointmentType | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null
  return { id: value.id, name: value.name }
}

function projectRows<T>(value: unknown, project: (row: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null
  const rows = value.map(project)
  return rows.every((row) => row !== null) ? rows : null
}

export function projectExternalWorkspace(value: unknown): ExternalWorkspace | null {
  if (!isRecord(value)) return null
  const patients = projectRows(value.patients, projectPatient)
  const appointments = projectRows(value.appointments, projectExternalAppointment)
  const appointment_types = projectRows(value.appointment_types, projectAppointmentType)
  return patients && appointments && appointment_types ? { patients, appointments, appointment_types } : null
}

export function parseExternalBookingRequest(value: unknown): ExternalBookingRequest | null {
  if (!isRecord(value) || Object.keys(value).length !== 6) return null
  const { id, patient_id, appointment_type_id, date, time, duration_minutes } = value
  if (typeof id !== 'string' || !UUID.test(id) || typeof patient_id !== 'string' || !UUID.test(patient_id)) return null
  if (typeof appointment_type_id !== 'string' || !UUID.test(appointment_type_id)) return null
  if (!isExternalDate(date) || typeof time !== 'string' || !BOOKING_TIME.test(time) || !isBookingDuration(duration_minutes)) return null
  return { id, patient_id, appointment_type_id, date, time, duration_minutes }
}

export function parseExternalAppointmentUpdate(value: unknown): ExternalAppointmentUpdate | null {
  if (!isRecord(value) || Object.keys(value).length !== 6) return null
  const { id, appointment_type_id, date, time, duration_minutes, status } = value
  if (typeof id !== 'string' || !UUID.test(id) || typeof appointment_type_id !== 'string' || !UUID.test(appointment_type_id)) return null
  if (!isExternalDate(date) || typeof time !== 'string' || !BOOKING_TIME.test(time) || !isBookingDuration(duration_minutes)) return null
  if (status !== 'scheduled' && status !== 'cancelled') return null
  return { id, appointment_type_id, date, time, duration_minutes, status }
}
