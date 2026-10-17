import type { AppointmentRecurrence } from './appointment-creation.ts'
import { generateRecurringAppointmentDates } from './recurrence.ts'
import type { ReferralSource } from '../supabase/types.ts'

export type NewPatientInput = {
  name: string
  phone: string
  email: string | null
  dob: string | null
  gender: string | null
  address: string | null
  medical_history: string | null
  notes: string | null
  referral_source: ReferralSource | null
  referred_by_doctor_id: string | null
  referred_by_patient_id: string | null
  referral_other: string | null
}

export type CreateAppointmentInput = {
  patientId?: string
  newPatient?: NewPatientInput | null
  date: string
  time: string
  durationMinutes: number
  appointmentTypeId: string
  fee: number | null
  assignedTo?: string | null
  externalStaffId?: string | null
  notes: string | null
  recurrence?: AppointmentRecurrence | null
}

export type CreateAppointmentResult =
  | { success: true; appointmentIds: string[]; createdPatientId?: string }
  | { success: false; errorCode: string; message: string; conflictingDates?: string[]; createdPatientId?: string }

export type BookingRequest = { correlationId: string; input: CreateAppointmentInput }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CORRELATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function isBookingCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && CORRELATION_UUID.test(value)
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function text(value: unknown, max: number): value is string | null | undefined {
  return value == null || (typeof value === 'string' && value.length <= max)
}
function id(value: unknown): value is string | null | undefined {
  return value == null || (typeof value === 'string' && UUID.test(value))
}
function normalizedId(value: string | null | undefined): string | null {
  return value?.toLowerCase() || null
}
function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
function parsePatient(value: unknown): NewPatientInput | null {
  if (!object(value) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200 ||
    typeof value.phone !== 'string' || !value.phone.trim() || value.phone.length > 50) return null
  const fields = { email: 254, dob: 10, gender: 50, address: 2000, medical_history: 10000, notes: 10000, referral_other: 2000 }
  for (const [key, max] of Object.entries(fields)) if (!text(value[key], max)) return null
  if (value.dob && !date(value.dob)) return null
  if (!id(value.referred_by_doctor_id) || !id(value.referred_by_patient_id)) return null
  const sources: unknown[] = [null, undefined, 'walk_in', 'doctor', 'google', 'patient', 'other']
  if (!sources.includes(value.referral_source)) return null
  return {
    name: value.name.trim(), phone: value.phone.trim(), email: (value.email as string) || null,
    dob: (value.dob as string) || null, gender: (value.gender as string) || null,
    address: (value.address as string) || null, medical_history: (value.medical_history as string) || null,
    notes: (value.notes as string) || null, referral_source: (value.referral_source as ReferralSource) || null,
    referred_by_doctor_id: normalizedId(value.referred_by_doctor_id),
    referred_by_patient_id: normalizedId(value.referred_by_patient_id),
    referral_other: (value.referral_other as string)?.trim() || null,
  }
}

export function parseBookingRequest(value: unknown):
  | { success: true; request: BookingRequest }
  | { success: false; result: CreateAppointmentResult } {
  const invalid = (): { success: false; result: CreateAppointmentResult } => ({
    success: false,
    result: { success: false, errorCode: 'BOOKING_INVALID_REQUEST', message: 'Check the appointment details and try again.' },
  })
  if (!object(value) || !isBookingCorrelationId(value.correlationId) || !object(value.input)) return invalid()
  const input = value.input
  if (!date(input.date) || typeof input.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.time) ||
    !Number.isInteger(input.durationMinutes) || (input.durationMinutes as number) < 1 || (input.durationMinutes as number) > 1440 ||
    typeof input.appointmentTypeId !== 'string' || !UUID.test(input.appointmentTypeId) ||
    !(input.fee === null || (typeof input.fee === 'number' && Number.isFinite(input.fee) && input.fee >= 0 && input.fee <= 99999999.99 && Number(input.fee.toFixed(2)) === input.fee)) ||
    !text(input.notes, 10000) || !id(input.patientId) || !id(input.assignedTo) || !id(input.externalStaffId) ||
    (input.assignedTo != null && input.externalStaffId != null)) return invalid()
  const newPatient = input.newPatient == null ? null : parsePatient(input.newPatient)
  if (input.newPatient != null && !newPatient) return invalid()
  if (Boolean(input.patientId) === Boolean(newPatient)) return invalid()
  let recurrence: AppointmentRecurrence | null = null
  if (input.recurrence != null) {
    if (!object(input.recurrence) || !Array.isArray(input.recurrence.weekdays) || input.recurrence.weekdays.length > 7 ||
      typeof input.recurrence.totalSessions !== 'number') return invalid()
    recurrence = { weekdays: input.recurrence.weekdays, totalSessions: input.recurrence.totalSessions }
    try {
      generateRecurringAppointmentDates({ startDate: input.date, ...recurrence })
    } catch {
      return invalid()
    }
  }
  return { success: true, request: {
    correlationId: value.correlationId.toLowerCase(),
    input: {
      patientId: normalizedId(input.patientId) ?? undefined, newPatient,
      date: input.date, time: input.time, durationMinutes: input.durationMinutes as number,
      appointmentTypeId: input.appointmentTypeId.toLowerCase(), fee: input.fee,
      assignedTo: normalizedId(input.assignedTo), externalStaffId: normalizedId(input.externalStaffId),
      notes: input.notes || null, recurrence,
    },
  } }
}
