function getFormatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  })
}

export function formatDashboardDate(date: Date, timeZone: string) {
  try {
    return getFormatter(timeZone).format(date)
  } catch {
    return getFormatter(DEFAULT_TIME_ZONE).format(date)
  }
}
import { DEFAULT_TIME_ZONE } from '../timezone.ts'
