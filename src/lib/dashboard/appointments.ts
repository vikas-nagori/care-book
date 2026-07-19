import { appointmentToInstant, isInstantInInterval } from '../timezone.ts'

interface AppointmentTimeRow {
  date: string
  time: string
  status: string
}

export function filterAppointmentsInInterval<T extends AppointmentTimeRow>(
  appointments: T[],
  start: Date,
  end: Date,
) {
  return appointments.filter((appointment) =>
    isInstantInInterval(appointmentToInstant(appointment.date, appointment.time), start, end)
  )
}

export function findNextScheduledAppointment<T extends AppointmentTimeRow>(
  appointments: T[],
  now: Date,
) {
  const nowTimestamp = now.getTime()

  return appointments
    .filter((appointment) => (
      appointment.status === 'scheduled'
      && appointmentToInstant(appointment.date, appointment.time).getTime() >= nowTimestamp
    ))
    .sort((left, right) => (
      appointmentToInstant(left.date, left.time).getTime()
      - appointmentToInstant(right.date, right.time).getTime()
    ))[0]
}
