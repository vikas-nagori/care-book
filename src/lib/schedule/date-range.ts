const KOLKATA_TIME_ZONE = 'Asia/Kolkata'
const RAIL_RADIUS_DAYS = 21
const STRICT_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat('en', {
  timeZone: 'UTC',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

export type ScheduleDateQueryInput = string | string[] | undefined

export interface ScheduleDateRange {
  selectedDate: string
  rangeStart: string
  rangeEnd: string
  railDates: string[]
}

export interface ScheduleRailDateAccessibility {
  ariaLabel: string
  ariaCurrent: 'date' | undefined
}

function isStrictCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false

  const match = STRICT_DATE_PATTERN.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function formatUtcDate(date: Date) {
  const year = date.getUTCFullYear().toString().padStart(4, '0')
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = date.getUTCDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addCalendarDays(date: string, amount: number) {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day))
  value.setUTCDate(value.getUTCDate() + amount)
  return formatUtcDate(value)
}

function getKolkataCalendarDate(now: Date) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: KOLKATA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function buildScheduleRailDates(selectedDate: string) {
  return Array.from(
    { length: RAIL_RADIUS_DAYS * 2 + 1 },
    (_, index) => addCalendarDays(selectedDate, index - RAIL_RADIUS_DAYS)
  )
}

export function isScheduleDateToday(date: string, todayDate: string) {
  return date === todayDate
}

export function getScheduleRailDateAccessibility(
  date: string,
  appointmentCount: number,
  isSelected: boolean
): ScheduleRailDateAccessibility {
  const fullDate = FULL_DATE_FORMATTER.format(new Date(`${date}T00:00:00.000Z`))
  const appointmentSummary = appointmentCount === 0
    ? 'no appointments'
    : `${appointmentCount} ${appointmentCount === 1 ? 'appointment' : 'appointments'}`

  return {
    ariaLabel: `${fullDate}, ${appointmentSummary}`,
    ariaCurrent: isSelected ? 'date' : undefined,
  }
}

export function resolveScheduleDateRange(
  dateInput?: ScheduleDateQueryInput,
  now: Date = new Date()
): ScheduleDateRange {
  const selectedDate = isStrictCalendarDate(dateInput)
    ? dateInput
    : getKolkataCalendarDate(now)
  const railDates = buildScheduleRailDates(selectedDate)

  return {
    selectedDate,
    rangeStart: railDates[0],
    rangeEnd: railDates[railDates.length - 1],
    railDates,
  }
}
