// Geometry-free model behind the monthly billed trend chart: which colour each appointment type
// wears, how a month's amount stacks into per-type segments, and the ₹ axis scale. Kept apart from
// the SVG so every number the chart draws is unit-testable without a renderer.

import type { BilledMonthPoint } from './monthly-billed-series.ts'

/**
 * Categorical slots in fixed order, tuned to the app's warm palette. Validated against the white
 * chart surface: every slot inside the lightness band, above the chroma floor and >= 3:1 contrast;
 * worst adjacent colour-blind separation ΔE 8.9, worst normal-vision separation ΔE 22.3.
 */
export const SERIES_COLORS = [
  '#0b8c7f', // teal
  '#cc6a3c', // terracotta
  '#4a78c0', // blue
  '#b8891a', // ochre
  '#a2559a', // plum
  '#5f8f2e', // olive
  '#6c5fc4', // violet
  '#cf5466', // rose
] as const

/** Neutral for the folded "Other" bucket, so it never borrows a categorical hue. */
export const OTHER_COLOR = '#a8a193'
export const OTHER_LABEL = 'Other'

export type TypeLegendEntry = { type: string; color: string }

export type TypeLegend = {
  /** Entries in stacking order: index 0 sits on the baseline. */
  entries: TypeLegendEntry[]
  /** Maps any appointment type name to the legend entry it is drawn as. */
  entryFor: (type: string) => TypeLegendEntry
}

/**
 * Assign each appointment type a colour once, from the full-month history, so a type keeps its
 * colour when the range toggles or a month is picked. Types are ordered by all-time amount (largest
 * first, ties by name) — the biggest type sits on the baseline where it is easiest to compare. Past
 * eight types the smallest fold into one neutral "Other" bucket rather than cycling colours.
 */
export function buildTypeLegend(series: BilledMonthPoint[]): TypeLegend {
  const totals = new Map<string, number>()
  for (const point of series) {
    for (const row of point.breakdown) totals.set(row.type, (totals.get(row.type) ?? 0) + row.amount)
  }
  const ordered = [...totals.entries()]
    .sort(([leftType, left], [rightType, right]) => right - left || leftType.localeCompare(rightType))
    .map(([type]) => type)

  const folds = ordered.length > SERIES_COLORS.length
  const named = folds ? ordered.slice(0, SERIES_COLORS.length - 1) : ordered
  const entries: TypeLegendEntry[] = named.map((type, index) => ({ type, color: SERIES_COLORS[index] }))
  const other: TypeLegendEntry = { type: OTHER_LABEL, color: OTHER_COLOR }
  if (folds) entries.push(other)

  const byType = new Map(entries.map((entry) => [entry.type, entry]))
  return {
    entries,
    // A type absent from the full history (only possible if the two series disagree) still draws,
    // as "Other", rather than vanishing from the stack.
    entryFor: (type) => byType.get(type) ?? other,
  }
}

export type StackSegment = { type: string; color: string; amount: number }

/**
 * One month's amount split into stack segments, baseline first, in legend order. Types folded into
 * "Other" are summed. Zero-amount types are dropped — they would draw nothing. The segments always
 * sum to the month's breakdown total, which is what the total line is plotted at.
 */
export function stackMonth(point: BilledMonthPoint, legend: TypeLegend): StackSegment[] {
  const amounts = new Map<string, number>()
  for (const row of point.breakdown) {
    const entry = legend.entryFor(row.type)
    amounts.set(entry.type, (amounts.get(entry.type) ?? 0) + row.amount)
  }
  const order = [...legend.entries]
  if (amounts.has(OTHER_LABEL) && !order.some((entry) => entry.type === OTHER_LABEL)) {
    order.push(legend.entryFor(OTHER_LABEL))
  }
  return order
    .filter((entry) => (amounts.get(entry.type) ?? 0) > 0)
    .map((entry) => ({ type: entry.type, color: entry.color, amount: amounts.get(entry.type) ?? 0 }))
}

export type ValueAxis = { max: number; step: number; ticks: number[] }

const TARGET_TICKS = 5

/** Round `value` up to a clean 1 / 2 / 2.5 / 5 × 10ⁿ. */
function niceStep(value: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)))
  const normalized = value / magnitude
  const step = [1, 2, 2.5, 5, 10].find((candidate) => normalized <= candidate) ?? 10
  return step * magnitude
}

/**
 * A ₹ axis from 0 that just clears `peak`, in about five round steps (0, 50K, 1L, 1.5L …), so the
 * tallest bar fills most of the plot instead of leaving the top half empty.
 */
export function buildValueAxis(peak: number): ValueAxis {
  if (!(peak > 0)) return { max: 1000, step: 250, ticks: [0, 250, 500, 750, 1000] }
  const step = niceStep(peak / TARGET_TICKS)
  const max = step * Math.ceil(peak / step - 1e-9)
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => Math.round(step * i * 100) / 100)
  return { max, step, ticks }
}

function trimDecimals(value: number, digits: number): string {
  // Math.round, not toFixed: toFixed rounds the binary value, so 45.55 would come out as 45.5.
  const factor = Math.pow(10, digits)
  return String(Math.round(value * factor) / factor)
}

/**
 * Short Indian-system rupee label for axis ticks and the on-chart total: ₹800, ₹45.6K, ₹2.05L,
 * ₹1.2Cr. Full figures live in the tooltip and the month panel.
 */
export function compactRupees(amount: number): string {
  const n = Math.round(amount)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  // Each unit hands over to the next once its rounded label would reach 100 (₹99,960 is ₹1L, not
  // ₹100K), so a label never shows a three-digit count of a unit that has a bigger name.
  if (abs >= 1e7 || Number(trimDecimals(abs / 1e5, 2)) >= 100) return `${sign}₹${trimDecimals(abs / 1e7, 2)}Cr`
  if (abs >= 1e5 || Number(trimDecimals(abs / 1e3, 1)) >= 100) return `${sign}₹${trimDecimals(abs / 1e5, 2)}L`
  if (abs >= 1e3) return `${sign}₹${trimDecimals(abs / 1e3, 1)}K`
  return `${sign}₹${abs}`
}

/** Full Indian-grouped rupee figure, e.g. ₹2,05,459. */
export function fullRupees(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`
}
