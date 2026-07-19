import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export const DEFAULT_TIME_ZONE = 'Asia/Kolkata'
export const CLINIC_TIME_ZONE = 'Asia/Kolkata'
export const USER_TIME_ZONE_COOKIE = 'care_book_timezone'

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const ZONED_DATE_SEARCH_WINDOW_MS = 36 * 60 * 60 * 1000

export interface ZonedCalendarContext {
  date: string
  time: string
  weekStart: string
  weekEnd: string
  monthStart: string
  monthEnd: string
  previousMonthStart: string
  previousMonthEnd: string
  monthLabel: string
  previousMonthLabel: string
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false

  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

export function resolveTimeZone(value: unknown) {
  return isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE
}

function dateKeyToUtcDate(value: string) {
  const match = DATE_KEY_PATTERN.exec(value)
  if (!match) throw new RangeError(`Invalid calendar date: ${value}`)

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date: ${value}`)
  }

  return date
}

function formatUtcDate(date: Date) {
  const year = date.getUTCFullYear().toString().padStart(4, '0')
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = date.getUTCDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addCalendarDays(value: string, amount: number) {
  const date = dateKeyToUtcDate(value)
  date.setUTCDate(date.getUTCDate() + amount)
  return formatUtcDate(date)
}

export function getZonedDate(now: Date, timeZone: string) {
  return formatInTimeZone(now, resolveTimeZone(timeZone), 'yyyy-MM-dd')
}

export function getZonedTime(now: Date, timeZone: string) {
  return formatInTimeZone(now, resolveTimeZone(timeZone), 'HH:mm')
}

export function getZonedCalendarContext(now: Date, timeZone: string): ZonedCalendarContext {
  const resolvedTimeZone = resolveTimeZone(timeZone)
  const date = getZonedDate(now, resolvedTimeZone)
  const utcDate = dateKeyToUtcDate(date)
  const mondayOffset = (utcDate.getUTCDay() + 6) % 7
  const weekStart = addCalendarDays(date, -mondayOffset)
  const weekEnd = addCalendarDays(weekStart, 6)
  const year = utcDate.getUTCFullYear()
  const monthIndex = utcDate.getUTCMonth()
  const monthStart = formatUtcDate(new Date(Date.UTC(year, monthIndex, 1)))
  const monthEnd = formatUtcDate(new Date(Date.UTC(year, monthIndex + 1, 0)))
  const previousMonthStart = formatUtcDate(new Date(Date.UTC(year, monthIndex - 1, 1)))
  const previousMonthEnd = formatUtcDate(new Date(Date.UTC(year, monthIndex, 0)))

  return {
    date,
    time: getZonedTime(now, resolvedTimeZone),
    weekStart,
    weekEnd,
    monthStart,
    monthEnd,
    previousMonthStart,
    previousMonthEnd,
    monthLabel: formatInTimeZone(dateKeyToUtcDate(monthStart), 'UTC', 'MMMM yyyy'),
    previousMonthLabel: formatInTimeZone(dateKeyToUtcDate(previousMonthStart), 'UTC', 'MMMM'),
  }
}

export function getZonedDayInterval(now: Date, timeZone: string) {
  const resolvedTimeZone = resolveTimeZone(timeZone)
  const date = getZonedDate(now, resolvedTimeZone)

  return getZonedDateInterval(date, addCalendarDays(date, 1), resolvedTimeZone)
}

function getZonedDateBoundary(date: string, timeZone: string) {
  const approximateNoon = fromZonedTime(`${date}T12:00:00`, timeZone).getTime()
  let beforeBoundary = approximateNoon - ZONED_DATE_SEARCH_WINDOW_MS
  let atOrAfterBoundary = approximateNoon + ZONED_DATE_SEARCH_WINDOW_MS

  if (
    getZonedDate(new Date(beforeBoundary), timeZone) >= date
    || getZonedDate(new Date(atOrAfterBoundary), timeZone) < date
  ) {
    throw new RangeError(`Unable to resolve timezone boundary for ${date}`)
  }

  while (atOrAfterBoundary - beforeBoundary > 1) {
    const midpoint = Math.floor((beforeBoundary + atOrAfterBoundary) / 2)

    if (getZonedDate(new Date(midpoint), timeZone) < date) {
      beforeBoundary = midpoint
    } else {
      atOrAfterBoundary = midpoint
    }
  }

  return new Date(atOrAfterBoundary)
}

export function getZonedDateInterval(
  startDate: string,
  endDate: string,
  timeZone: string,
) {
  dateKeyToUtcDate(startDate)
  dateKeyToUtcDate(endDate)
  const resolvedTimeZone = resolveTimeZone(timeZone)

  return {
    start: getZonedDateBoundary(startDate, resolvedTimeZone),
    end: getZonedDateBoundary(endDate, resolvedTimeZone),
  }
}

export function getClinicDateRangeForInterval(start: Date, end: Date) {
  if (end.getTime() <= start.getTime()) {
    throw new RangeError('Timezone interval end must be after its start')
  }

  return {
    startDate: formatInTimeZone(start, CLINIC_TIME_ZONE, 'yyyy-MM-dd'),
    endDate: formatInTimeZone(new Date(end.getTime() - 1), CLINIC_TIME_ZONE, 'yyyy-MM-dd'),
  }
}

export function appointmentToInstant(date: string, time: string) {
  dateKeyToUtcDate(date)
  return fromZonedTime(`${date}T${time}`, CLINIC_TIME_ZONE)
}

export function isInstantInInterval(value: Date, start: Date, end: Date) {
  const timestamp = value.getTime()
  return timestamp >= start.getTime() && timestamp < end.getTime()
}

export function formatDateOnly(value: string, pattern: string) {
  return formatInTimeZone(dateKeyToUtcDate(value), 'UTC', pattern)
}
