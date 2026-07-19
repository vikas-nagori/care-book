import { DEFAULT_TIME_ZONE, getZonedDate } from '../timezone.ts'

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

export interface ScheduleDateNavigation {
  href: string
  options: { scroll: false }
}

export interface ScheduleRailCenteringInput {
  railIsVisible: boolean
  chipIsVisible: boolean
  selectedDate: string
  lastCenteredDate: string | null
  railWidth: number
  lastRailWidth: number | null
  wasVisible: boolean
  prefersReducedMotion: boolean
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

export function getScheduleDateNavigation(date: string): ScheduleDateNavigation {
  return {
    href: `/schedule?date=${date}`,
    options: { scroll: false },
  }
}

export function getScheduleRailCenteringBehavior({
  railIsVisible,
  chipIsVisible,
  selectedDate,
  lastCenteredDate,
  railWidth,
  lastRailWidth,
  wasVisible,
  prefersReducedMotion,
}: ScheduleRailCenteringInput): 'auto' | 'smooth' | null {
  if (!railIsVisible || !chipIsVisible) return null

  const needsInitialCenter = lastCenteredDate === null
  const becameVisible = !wasVisible
  const selectionChanged = lastCenteredDate !== null && lastCenteredDate !== selectedDate
  const sizeChanged = lastRailWidth !== railWidth

  if (!needsInitialCenter && !becameVisible && !selectionChanged && !sizeChanged) return null
  return selectionChanged && !becameVisible && !prefersReducedMotion ? 'smooth' : 'auto'
}

export function resolveScheduleDateRange(
  dateInput?: ScheduleDateQueryInput,
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE,
): ScheduleDateRange {
  const selectedDate = isStrictCalendarDate(dateInput)
    ? dateInput
    : getZonedDate(now, timeZone)
  const railDates = buildScheduleRailDates(selectedDate)

  return {
    selectedDate,
    rangeStart: railDates[0],
    rangeEnd: railDates[railDates.length - 1],
    railDates,
  }
}
