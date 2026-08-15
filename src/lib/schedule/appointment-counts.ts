/**
 * Statuses a date chip should tally. A cancelled appointment is not work on the calendar — counting
 * it made a day of wash-outs read as a full day, which is the opposite of what the count is for.
 */
const COUNTED_STATUSES = new Set(['scheduled', 'completed'])

export function isCountedScheduleStatus(status: string | null | undefined): boolean {
  return COUNTED_STATUSES.has(status ?? '')
}

/**
 * Appointments on `date` that the date-strip chip should count: scheduled and completed only.
 * Both the desktop strip and the mobile rolling rail run through this so the two never disagree.
 */
export function countScheduleAppointmentsOnDate(
  appointments: readonly { date: string; status?: string | null }[],
  date: string,
): number {
  return appointments.reduce(
    (count, appointment) =>
      appointment.date === date && isCountedScheduleStatus(appointment.status) ? count + 1 : count,
    0,
  )
}
