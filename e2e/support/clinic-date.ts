const CLINIC_TIME_ZONE = 'Asia/Kolkata'
const DASHBOARD_FIXTURE_LEAD_MS = 6 * 60 * 60 * 1000

/** Return a YYYY-MM-DD calendar date in the clinic timezone, optionally offset by whole days. */
export function clinicDate(dayOffset = 0, now = new Date()): string {
  const target = new Date(now.getTime() + dayOffset * 86_400_000)
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: CLINIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(target)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

/**
 * Return a dashboard appointment far enough in the future to outlive a full E2E run. Unlike a
 * fixed end-of-day time, this safely rolls into the following clinic date near midnight.
 */
export function upcomingClinicSlot(now = new Date()): { date: string; time: string } {
  const target = new Date(now.getTime() + DASHBOARD_FIXTURE_LEAD_MS)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CLINIC_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(target)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value

  return {
    date: clinicDate(0, target),
    time: `${value('hour')}:${value('minute')}`,
  }
}
