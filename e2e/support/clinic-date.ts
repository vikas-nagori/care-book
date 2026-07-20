const CLINIC_TIME_ZONE = 'Asia/Kolkata'

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
