import { addDays, format, getDay, isValid, parseISO } from 'date-fns'

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
export const MAX_RECURRING_APPOINTMENTS = 100

export type RecurrenceInput = {
  startDate: string
  weekdays: number[]
  totalSessions: number
}

export function generateRecurringAppointmentDates({
  startDate,
  weekdays,
  totalSessions,
}: RecurrenceInput) {
  const parsedStart = parseISO(startDate)
  if (
    !ISO_DATE_PATTERN.test(startDate) ||
    !isValid(parsedStart) ||
    format(parsedStart, 'yyyy-MM-dd') !== startDate
  ) {
    throw new Error('Enter a valid start date.')
  }

  if (!Number.isInteger(totalSessions) || totalSessions < 1 || totalSessions > MAX_RECURRING_APPOINTMENTS) {
    throw new Error(`Total sessions must be between 1 and ${MAX_RECURRING_APPOINTMENTS}.`)
  }

  if (
    weekdays.length === 0 ||
    weekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
  ) {
    throw new Error('Choose at least one valid weekday.')
  }

  const selectedWeekdays = new Set(weekdays)
  const dates: string[] = []
  let candidate = parsedStart

  while (dates.length < totalSessions) {
    if (selectedWeekdays.has(getDay(candidate))) {
      dates.push(format(candidate, 'yyyy-MM-dd'))
    }
    candidate = addDays(candidate, 1)
  }

  return dates
}
