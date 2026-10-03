export type LogRecord = { id: string; timestamp: number; level?: string; responseStatusCode?: number; message?: string }
export async function collectLogPages(
  fetchPage: (until: string) => Promise<LogRecord[]>,
  start: string, end: string, pageSize = 50, maxPages = 500,
) {
  const from = Date.parse(start), to = Date.parse(end)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error('Invalid time window')
  let cursor = to
  const records = new Map<string, LogRecord>()
  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchPage(new Date(cursor).toISOString())
    if (rows.length > pageSize) throw new Error('Provider exceeded the requested page size')
    for (const row of rows) {
      if (!row.id || !Number.isFinite(row.timestamp) || row.timestamp > cursor) throw new Error('Invalid or non-paginated log response')
      if (row.timestamp >= from && row.timestamp < to) records.set(row.id, row)
    }
    if (rows.length < pageSize) return [...records.values()]
    const oldest = Math.min(...rows.map(row => row.timestamp))
    if (oldest < from) return [...records.values()]
    // Include the boundary again to avoid losing records sharing its timestamp.
    // A full same-timestamp page needs a provider ID cursor; never claim it is complete.
    if (oldest >= cursor) throw new Error('Pagination stalled: timestamp boundary is saturated')
    cursor = oldest
  }
  throw new Error('Page budget exhausted; log coverage is incomplete')
}
