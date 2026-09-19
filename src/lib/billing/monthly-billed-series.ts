// Month-by-month "total billed" series for the Billed drill-down trendline.
//
// The input is already aggregated by Postgres (get_billed_month_totals_v1) into one bucket per
// month × appointment type, so this never sees an individual session: the whole history arrives as
// a few dozen rows rather than every appointment ever completed. This module's job is presentation
// shape — collapse the buckets into one point per month, attach that month's type breakdown, and
// fill gap months with 0 so the trendline has no holes.

import { format, parseISO } from 'date-fns'
import { UNTYPED_LABEL, type AppointmentTypeBreakdownRow } from './appointment-type-breakdown.ts'

/** One pre-aggregated (month, appointment type) total, as returned by the RPC. */
export type BilledMonthBucket = {
  /** Calendar month key, `YYYY-MM`. */
  month: string
  /** Appointment type name; null/blank collapses into "Untyped". */
  type: string | null | undefined
  /** Summed session fees. PostgREST may deliver `numeric` as a string. */
  amount: number | string | null | undefined
  /** Number of completed sessions behind `amount`. */
  sessionCount: number | string | null | undefined
}

export type BilledMonthPoint = {
  /** Calendar month key, `YYYY-MM`. */
  month: string
  /** Short display label, e.g. `Jul '26`. */
  label: string
  /** Total billed in the month. */
  amount: number
  /** Per-appointment-type split of `amount`, largest first. Empty for a gap month. */
  breakdown: AppointmentTypeBreakdownRow[]
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

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Build the continuous monthly billed series from pre-aggregated buckets. The range runs from the
 * earliest bucket month (or `currentMonth` if that is earlier) through the later of `currentMonth`
 * and the latest bucket month, so the current month always appears even when it has no billing yet.
 * Returns `[]` when there are no buckets.
 */
export function buildMonthlyBilledSeries(
  buckets: BilledMonthBucket[],
  currentMonth: string,
): BilledMonthPoint[] {
  const byMonth = new Map<string, Map<string, AppointmentTypeBreakdownRow>>()

  for (const entry of buckets) {
    const trimmed = entry.type?.trim()
    const type = trimmed ? trimmed : UNTYPED_LABEL
    const amount = toNumber(entry.amount)
    const count = toNumber(entry.sessionCount)

    let types = byMonth.get(entry.month)
    if (!types) {
      types = new Map()
      byMonth.set(entry.month, types)
    }

    const existing = types.get(type)
    if (existing) {
      existing.amount += amount
      existing.count += count
    } else {
      types.set(type, { type, amount, count })
    }
  }

  if (byMonth.size === 0) return []

  const keys = [...byMonth.keys()]
  const currentIndex = monthIndex(currentMonth)
  const startIndex = Math.min(currentIndex, ...keys.map(monthIndex))
  const endIndex = Math.max(currentIndex, ...keys.map(monthIndex))

  const series: BilledMonthPoint[] = []
  for (let index = startIndex; index <= endIndex; index++) {
    const month = monthKeyFromIndex(index)
    const breakdown = Array.from(byMonth.get(month)?.values() ?? []).sort(
      (left, right) => right.amount - left.amount || left.type.localeCompare(right.type),
    )
    series.push({
      month,
      label: format(parseISO(`${month}-01`), "MMM ''yy"),
      amount: breakdown.reduce((sum, row) => sum + row.amount, 0),
      breakdown,
    })
  }
  return series
}
