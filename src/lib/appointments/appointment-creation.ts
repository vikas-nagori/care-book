import { getDay, parseISO } from 'date-fns'
import { generateRecurringAppointmentDates } from './recurrence.ts'

export type AppointmentRecurrence = {
  weekdays: number[]
  totalSessions: number
}

export type AppointmentCreationDetails = {
  patientId: string
  date: string
  time: string
  durationMinutes: number
  appointmentTypeId: string
  fee: number | null
  assignedTo?: string | null
  externalStaffId?: string | null
  notes: string | null
  recurrence?: AppointmentRecurrence | null
  /**
   * The clinic's current calendar date (YYYY-MM-DD). Required, not defaulted: the caller knows the
   * clinic timezone and this module must not guess it from the server clock.
   */
  today: string
}

/**
 * Booking a date that has already passed is a record of something that happened, not a plan — the
 * session was delivered and is being logged after the fact. So a backdated row is created
 * 'completed' and a today-or-later row 'scheduled'. Recurrences that start in the past are split the
 * same way, date by date.
 */
export function resolveAppointmentStatus(date: string, today: string): 'scheduled' | 'completed' {
  return date < today ? 'completed' : 'scheduled'
}

export function buildAppointmentInsertRows(input: AppointmentCreationDetails) {
  const dates = input.recurrence
    ? generateRecurringAppointmentDates({
        startDate: input.date,
        weekdays: input.recurrence.weekdays,
        totalSessions: input.recurrence.totalSessions,
      })
    : generateRecurringAppointmentDates({
        startDate: input.date,
        weekdays: [getDay(parseISO(input.date))],
        totalSessions: 1,
      })

  return dates.map((date) => ({
    patient_id: input.patientId,
    date,
    time: input.time,
    duration_minutes: input.durationMinutes || 45,
    appointment_type_id: input.appointmentTypeId,
    status: resolveAppointmentStatus(date, input.today),
    fee: input.fee,
    assigned_to: input.assignedTo || null,
    external_staff_id: input.externalStaffId || null,
    notes: input.notes || null,
  }))
}
