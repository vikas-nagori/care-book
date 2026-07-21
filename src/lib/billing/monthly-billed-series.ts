// Month-by-month "total billed" series for the Billed drill-down trendline. Each point sums the fees
// of the completed sessions in that calendar month. The series is continuous from the org's first
// billed month through the current month (gap months filled with 0) so the trendline has no holes.

import { format, parseISO } from 'date-fns'

export type BilledMonthPoint = {
  /** Calendar month key, `YYYY-MM`. */
  month: string
  /** Short display label, e.g. `Jul '26`. */
  label: string
  /** Total billed (sum of completed session fees) in the month. */
  amount: number
}

export type BilledSessionDate = {
  /** Session date, `YYYY-MM-DD` (a plain date — no timezone math needed to bucket by month). */
  date: string
  fee: number | null | undefined
}

/** `YYYY-MM` -> absolute month index (year*12 + monthIndex), for gap-free iteration. */
function monthIndex(monthKey: string): number {
  const [year, month] = monthKey.split('-').map(Number)
  return year * 12 + (month - 1)
}

/** Absolute month index -> `YYYY-MM`. */
function monthKeyFromIndex(index: number): string {
  const year = Math.floor(index / 12)
  const month = index % 12
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

/**
 * Build the continuous monthly billed series. Sessions are bucketed by the month of their `date`;
 * the range runs from the earliest session month (or `currentMonth` if that is earlier) through the
 * later of `currentMonth` and the latest session month, so the current month always appears even
 * when it has no billing yet. Returns `[]` when there are no sessions.
 */
export function buildMonthlyBilledSeries(
  sessions: BilledSessionDate[],
  currentMonth: string,
): BilledMonthPoint[] {
  const totals = new Map<string, number>()
  for (const session of sessions) {
    const key = session.date.slice(0, 7)
    const fee = Number(session.fee ?? 0)
    totals.set(key, (totals.get(key) ?? 0) + (Number.isFinite(fee) ? fee : 0))
  }

  if (totals.size === 0) return []

  const keys = [...totals.keys()]
  const currentIndex = monthIndex(currentMonth)
  const startIndex = Math.min(currentIndex, ...keys.map(monthIndex))
  const endIndex = Math.max(currentIndex, ...keys.map(monthIndex))

  const series: BilledMonthPoint[] = []
  for (let index = startIndex; index <= endIndex; index++) {
    const month = monthKeyFromIndex(index)
    series.push({
      month,
      label: format(parseISO(`${month}-01`), "MMM ''yy"),
      amount: totals.get(month) ?? 0,
    })
  }
  return series
}
