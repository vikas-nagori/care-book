import { fromZonedTime } from 'date-fns-tz'
import {
  addCalendarDays,
  CLINIC_TIME_ZONE,
  getClinicDateRangeForInterval,
  getZonedDate,
  getZonedDateInterval,
  getZonedTime,
} from '../timezone.ts'
import { isExternalDate } from './workspace.ts'

export function getExternalCalendarDay(date: string | undefined, now: Date, timeZone: string) {
  const today = getZonedDate(now, timeZone)
  const selectedDate = isExternalDate(date) && date > '0100-01-01' && date < '9999-12-31' ? date : today
  const interval = getZonedDateInterval(selectedDate, addCalendarDays(selectedDate, 1), timeZone)
  // A timezone change can skip an entire local day, making this range empty.
  const clinicDates = interval.start < interval.end
    ? getClinicDateRangeForInterval(interval.start, interval.end)
    : getClinicDateRangeForInterval(now, new Date(now.getTime() + 1))
  return { selectedDate, today, ...interval, clinicDates }
}

export function getClinicBookingSlot(date: string, time: string, timeZone: string) {
  if (!isExternalDate(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  const instant = fromZonedTime(`${date}T${time}`, timeZone)
  if (!Number.isFinite(instant.getTime()) || getZonedDate(instant, timeZone) !== date || getZonedTime(instant, timeZone) !== time) {
    return null
  }
  return { date: getZonedDate(instant, CLINIC_TIME_ZONE), time: getZonedTime(instant, CLINIC_TIME_ZONE) }
}

const RAIL_RADIUS_DAYS = 21

/**
 * The External Staff schedule shows the same ±3-week date rail as the clinic schedule, in the
 * viewer's own zone. Returns the viewer-local dates plus the clinic-date span to load.
 */
export function getExternalScheduleRange(date: string | undefined, now: Date, timeZone: string) {
  const today = getZonedDate(now, timeZone)
  const selectedDate = isExternalDate(date) && date > '0100-01-01' && date < '9999-12-01' ? date : today
  const railDates = Array.from({ length: RAIL_RADIUS_DAYS * 2 + 1 }, (_, i) => addCalendarDays(selectedDate, i - RAIL_RADIUS_DAYS))
  const interval = getZonedDateInterval(railDates[0], addCalendarDays(railDates[railDates.length - 1], 1), timeZone)
  const clinicDates = getClinicDateRangeForInterval(interval.start, interval.end)
  return { selectedDate, today, railDates, clinicDates }
}

/** An appointment's start as the viewer sees it: their local date and HH:mm. */
export function toViewerSlot(appointment: { date: string; time: string }, timeZone: string) {
  const instant = appointmentToInstantSafe(appointment.date, appointment.time)
  return { date: getZonedDate(instant, timeZone), time: getZonedTime(instant, timeZone) }
}

/** Clinic-local date/time → the viewer's date/time strings, for prefilling edit forms. */
function appointmentToInstantSafe(date: string, time: string) {
  return fromZonedTime(`${date}T${time.slice(0, 5)}`, CLINIC_TIME_ZONE)
}
