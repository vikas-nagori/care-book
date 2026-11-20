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
