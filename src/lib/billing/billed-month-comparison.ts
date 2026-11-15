// Month-on-month comparison for the monthly billed trend's month panel: the selected month against
// the month before it, as a whole and per appointment type, plus the "billed till date" cutoff.

import type { AppointmentTypeBreakdownRow } from './appointment-type-breakdown.ts'
import type { BilledMonthPoint } from './monthly-billed-series.ts'

/**
 * Days of the current month that are over, from a clinic-calendar `YYYY-MM-DD` date. Today is still
 * being billed, so the till-date comparison stops at yesterday: every month is then compared over
 * the same span of finished days. On the 1st nothing is finished yet and this is 0.
 */
export function completedDaysInMonth(calendarDate: string): number {
  const day = Number(calendarDate.slice(8, 10))
  if (!Number.isInteger(day) || day < 1) throw new Error(`completedDaysInMonth: bad date ${calendarDate}`)
  return day - 1
}

export type MonthDelta =
  /** Both months had something billed: a signed percentage change. */
  | { kind: 'change'; percent: number; difference: number }
  /** Nothing the month before, something now: a percentage would be infinite. */
  | { kind: 'new'; difference: number }
  /** Nothing in either month. */
  | { kind: 'none' }

export function monthDelta(current: number, previous: number): MonthDelta {
  const difference = current - previous
  if (previous > 0) return { kind: 'change', percent: (difference / previous) * 100, difference }
  if (current > 0) return { kind: 'new', difference }
  return { kind: 'none' }
}

/** `+12%`, `−3.4%`, `0%`: one decimal under 10%, whole numbers above; a true minus sign. */
export function formatPercent(percent: number): string {
  const rounded = Math.abs(percent) < 10 ? Math.round(percent * 10) / 10 : Math.round(percent)
  if (rounded === 0) return '0%'
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`
}

/** Direction a delta reads as once rounded for display — a 0.04% move is flat, not up. */
export function deltaDirection(delta: MonthDelta): 'up' | 'down' | 'flat' | 'new' | 'none' {
  if (delta.kind !== 'change') return delta.kind
  const shown = formatPercent(delta.percent)
  return shown === '0%' ? 'flat' : shown.startsWith('+') ? 'up' : 'down'
}

export type TypeComparisonRow = AppointmentTypeBreakdownRow & {
  previousAmount: number
  delta: MonthDelta
}

export type MonthComparison = {
  previous: BilledMonthPoint
  total: MonthDelta
  /** The month's own types, largest first, then types billed only the month before (now ₹0). */
  byType: TypeComparisonRow[]
}

/**
 * Compare a month with the one before it. Returns null when there is no earlier month to compare
 * against. A type that billed last month but not this one is kept as a ₹0 row, so a drop to nothing
 * shows as −100% instead of silently disappearing from the list.
 */
export function compareWithPreviousMonth(
  series: BilledMonthPoint[],
  month: string,
): MonthComparison | null {
  const index = series.findIndex((point) => point.month === month)
  if (index < 1) return null
  const current = series[index]
  const previous = series[index - 1]

  const previousByType = new Map(previous.breakdown.map((row) => [row.type, row.amount]))
  const currentTypes = new Set(current.breakdown.map((row) => row.type))

  const byType: TypeComparisonRow[] = current.breakdown.map((row) => {
    const previousAmount = previousByType.get(row.type) ?? 0
    return { ...row, previousAmount, delta: monthDelta(row.amount, previousAmount) }
  })
  const dropped = previous.breakdown
    .filter((row) => !currentTypes.has(row.type))
    .sort((left, right) => right.amount - left.amount || left.type.localeCompare(right.type))
    .map((row) => ({
      type: row.type,
      amount: 0,
      count: 0,
      previousAmount: row.amount,
      delta: monthDelta(0, row.amount),
    }))

  return { previous, total: monthDelta(current.amount, previous.amount), byType: [...byType, ...dropped] }
}
