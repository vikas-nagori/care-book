// Groups the flat record list behind a billing metric tile into one bucket per calendar date, so the
// drill-down can render a collapsed accordion per day with that day's own total. Pagination then runs
// over whole date groups rather than individual records — a date never straddles a page boundary, so
// the total shown on a group header is always the complete total for that day.

import { format, parseISO } from 'date-fns'

export type DateGroupedRow = {
  id: string
  /** Record date, `YYYY-MM-DD` (a plain date — no timezone math needed to bucket by day). */
  date: string
  amount: number
}

export type DateGroup<Row extends DateGroupedRow> = {
  /** Calendar date key, `YYYY-MM-DD`. */
  date: string
  /** Short display label, e.g. `18 Sep`. */
  label: string
  /** Number of records on the date. A record counts even when its amount is 0. */
  count: number
  /**
   * Sum of the date's record amounts. Received rows carry refunds as negative amounts, so a day
   * whose refunds outweigh its payments legitimately totals below zero.
   */
  total: number
  rows: Row[]
}

/**
 * Bucket records by date, newest date first, preserving the caller's row order inside each date.
 * Non-finite amounts count as 0 so a group total always sums its own rows.
 */
export function groupMetricRowsByDate<Row extends DateGroupedRow>(rows: Row[]): DateGroup<Row>[] {
  const groups = new Map<string, DateGroup<Row>>()

  for (const row of rows) {
    const amount = Number(row.amount)
    const existing = groups.get(row.date)
    if (existing) {
      existing.rows.push(row)
      existing.count += 1
      existing.total += Number.isFinite(amount) ? amount : 0
    } else {
      groups.set(row.date, {
        date: row.date,
        label: format(parseISO(row.date), 'dd MMM'),
        count: 1,
        total: Number.isFinite(amount) ? amount : 0,
        rows: [row],
      })
    }
  }

  return Array.from(groups.values()).sort((left, right) => right.date.localeCompare(left.date))
}

/** Slice whole date groups for the requested page. `totalPages` is at least 1 even when empty. */
export function paginateDateGroups<Row extends DateGroupedRow>(
  groups: DateGroup<Row>[],
  { page, pageSize }: { page: number; pageSize: number },
): { groups: DateGroup<Row>[]; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(groups.length / pageSize))
  const start = (page - 1) * pageSize
  return { groups: groups.slice(start, start + pageSize), totalPages }
}
