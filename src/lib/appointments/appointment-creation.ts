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
    status: 'scheduled' as const,
    fee: input.fee,
    assigned_to: input.assignedTo || null,
    external_staff_id: input.externalStaffId || null,
    notes: input.notes || null,
  }))
}
