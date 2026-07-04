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
    return getFormatter('UTC').format(date)
  }
}
