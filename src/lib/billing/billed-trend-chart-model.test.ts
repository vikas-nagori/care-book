import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OTHER_COLOR,
  OTHER_LABEL,
  SERIES_COLORS,
  buildTypeLegend,
  buildValueAxis,
  compactRupees,
  fullRupees,
  stackMonth,
} from './billed-trend-chart-model.ts'
import type { BilledMonthPoint } from './monthly-billed-series.ts'

function month(key: string, rows: Array<[string, number]>): BilledMonthPoint {
  const breakdown = rows.map(([type, amount]) => ({ type, amount, count: 1 }))
  return { month: key, label: key, amount: breakdown.reduce((sum, row) => sum + row.amount, 0), breakdown }
}

const history = [
  month('2026-08', [['Clinic', 90_000], ['Home', 40_000], ['Online', 5_000]]),
  month('2026-09', [['Home', 70_000], ['Clinic', 60_000]]),
  month('2026-10', []),
  month('2026-11', [['Spinal Bed', 2_000], ['Clinic', 10_000]]),
]

test('types are coloured by all-time amount, largest first, in fixed slot order', () => {
  const legend = buildTypeLegend(history)
  assert.deepEqual(legend.entries, [
    { type: 'Clinic', color: SERIES_COLORS[0] },
    { type: 'Home', color: SERIES_COLORS[1] },
    { type: 'Online', color: SERIES_COLORS[2] },
    { type: 'Spinal Bed', color: SERIES_COLORS[3] },
  ])
})

test('a type keeps its colour when only a subset of months is drawn', () => {
  const legend = buildTypeLegend(history)
  // The till-date view of November only has Spinal Bed, yet it must not be repainted as slot 1.
  const segments = stackMonth(month('2026-11', [['Spinal Bed', 2_000]]), legend)
  assert.deepEqual(segments, [{ type: 'Spinal Bed', color: SERIES_COLORS[3], amount: 2_000 }])
})

test('ties on amount are broken by name so colours never shuffle between renders', () => {
  const legend = buildTypeLegend([month('2026-01', [['Zeta', 100], ['Alpha', 100]])])
  assert.deepEqual(legend.entries.map((entry) => entry.type), ['Alpha', 'Zeta'])
})

test('a month stacks baseline-first in legend order and sums to its total', () => {
  const legend = buildTypeLegend(history)
  const segments = stackMonth(history[1], legend)
  assert.deepEqual(segments.map((s) => s.type), ['Clinic', 'Home'])
  assert.equal(segments.reduce((sum, s) => sum + s.amount, 0), history[1].amount)
})

test('a gap month has no segments', () => {
  assert.deepEqual(stackMonth(history[2], buildTypeLegend(history)), [])
})

test('zero-amount types draw nothing', () => {
  const legend = buildTypeLegend(history)
  assert.deepEqual(stackMonth(month('2026-12', [['Clinic', 0], ['Home', 500]]), legend).map((s) => s.type), ['Home'])
})

test('past eight types the smallest fold into a neutral Other bucket instead of cycling hues', () => {
  const rows: Array<[string, number]> = Array.from({ length: 10 }, (_, i) => [`T${i}`, 1000 - i * 10])
  const point = month('2026-01', rows)
  const legend = buildTypeLegend([point])

  assert.equal(legend.entries.length, SERIES_COLORS.length)
  assert.deepEqual(legend.entries.at(-1), { type: OTHER_LABEL, color: OTHER_COLOR })
  assert.equal(new Set(legend.entries.map((entry) => entry.color)).size, legend.entries.length)

  const segments = stackMonth(point, legend)
  const other = segments.find((s) => s.type === OTHER_LABEL)
  assert.equal(other?.amount, 930 + 920 + 910) // T7, T8, T9
  assert.equal(segments.reduce((sum, s) => sum + s.amount, 0), point.amount)
})

test('a type missing from the legend still draws, as Other', () => {
  const legend = buildTypeLegend(history)
  const segments = stackMonth(month('2026-12', [['Clinic', 100], ['Brand new', 50]]), legend)
  assert.deepEqual(segments, [
    { type: 'Clinic', color: SERIES_COLORS[0], amount: 100 },
    { type: OTHER_LABEL, color: OTHER_COLOR, amount: 50 },
  ])
})

test('the axis just clears the peak in round steps', () => {
  assert.deepEqual(buildValueAxis(205_459), { max: 250_000, step: 50_000, ticks: [0, 50_000, 100_000, 150_000, 200_000, 250_000] })
  assert.deepEqual(buildValueAxis(173_900).max, 200_000)
  assert.deepEqual(buildValueAxis(45_550).max, 50_000)
  assert.deepEqual(buildValueAxis(1_800), { max: 2_000, step: 500, ticks: [0, 500, 1_000, 1_500, 2_000] })
})

test('an exact multiple of the step is not padded with an empty extra step', () => {
  assert.equal(buildValueAxis(200_000).max, 200_000)
})

test('the axis always has a top above zero, even with nothing billed', () => {
  const axis = buildValueAxis(0)
  assert.ok(axis.max > 0)
  assert.equal(axis.ticks[0], 0)
})

test('every tick stays inside the axis and the top tick is the max', () => {
  for (const peak of [1, 7, 333, 9_999, 12_345, 99_999, 2_050_000, 31_000_000]) {
    const axis = buildValueAxis(peak)
    assert.ok(axis.max >= peak, `max ${axis.max} < peak ${peak}`)
    assert.equal(axis.ticks.at(-1), axis.max)
    assert.ok(axis.ticks.length >= 2 && axis.ticks.length <= 11, `${peak}: ${axis.ticks.length} ticks`)
  }
})

test('compact rupees use the Indian system', () => {
  assert.equal(compactRupees(0), '₹0')
  assert.equal(compactRupees(800), '₹800')
  assert.equal(compactRupees(50_000), '₹50K')
  assert.equal(compactRupees(45_550), '₹45.6K')
  assert.equal(compactRupees(150_000), '₹1.5L')
  assert.equal(compactRupees(205_459), '₹2.05L')
  assert.equal(compactRupees(12_000_000), '₹1.2Cr')
})

test('compact rupees never show 100 of a unit that has a bigger name', () => {
  assert.equal(compactRupees(99_960), '₹1L')
  assert.equal(compactRupees(9_999_700), '₹1Cr')
})

test('full rupees group the Indian way', () => {
  assert.equal(fullRupees(205_459), '₹2,05,459')
  assert.equal(fullRupees(1234.6), '₹1,235')
})
