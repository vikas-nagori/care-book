import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareWithPreviousMonth,
  completedDaysInMonth,
  deltaDirection,
  formatPercent,
  monthDelta,
} from './billed-month-comparison.ts'
import type { BilledMonthPoint } from './monthly-billed-series.ts'

function month(key: string, rows: Array<[string, number, number?]>): BilledMonthPoint {
  const breakdown = rows.map(([type, amount, count]) => ({ type, amount, count: count ?? 1 }))
  return { month: key, label: key, amount: breakdown.reduce((sum, row) => sum + row.amount, 0), breakdown }
}

test('the till-date cutoff is the last finished day, never today', () => {
  assert.equal(completedDaysInMonth('2026-11-15'), 14)
  assert.equal(completedDaysInMonth('2026-11-02'), 1)
  assert.equal(completedDaysInMonth('2026-12-31'), 30)
})

test('on the 1st no day of the month is finished yet', () => {
  assert.equal(completedDaysInMonth('2026-12-01'), 0)
})

test('a malformed date is refused rather than turned into a cutoff', () => {
  assert.throws(() => completedDaysInMonth('2026-12'))
  assert.throws(() => completedDaysInMonth('2026-12-00'))
})

test('percentage change is against the earlier month', () => {
  assert.deepEqual(monthDelta(150, 100), { kind: 'change', percent: 50, difference: 50 })
  assert.deepEqual(monthDelta(75, 100), { kind: 'change', percent: -25, difference: -25 })
  assert.deepEqual(monthDelta(0, 100), { kind: 'change', percent: -100, difference: -100 })
})

test('growth from nothing is "new", not an infinite percentage', () => {
  assert.deepEqual(monthDelta(500, 0), { kind: 'new', difference: 500 })
  assert.deepEqual(monthDelta(0, 0), { kind: 'none' })
})

test('percentages read cleanly', () => {
  assert.equal(formatPercent(50), '+50%')
  assert.equal(formatPercent(-25), '−25%')
  assert.equal(formatPercent(3.44), '+3.4%')
  assert.equal(formatPercent(-0.04), '0%')
  assert.equal(formatPercent(12.6), '+13%')
  assert.equal(formatPercent(9.96), '+10%')
})

test('direction follows what is displayed, so a rounded-away change is flat', () => {
  assert.equal(deltaDirection(monthDelta(101, 100)), 'up')
  assert.equal(deltaDirection(monthDelta(99, 100)), 'down')
  assert.equal(deltaDirection(monthDelta(100_001, 100_000)), 'flat')
  assert.equal(deltaDirection(monthDelta(1, 0)), 'new')
  assert.equal(deltaDirection(monthDelta(0, 0)), 'none')
})

const series = [
  month('2026-09', [['Clinic', 60_000, 50], ['Home', 40_000, 20], ['Online', 5_000, 4]]),
  month('2026-10', [['Clinic', 90_000, 70], ['Home', 30_000, 15], ['Spinal Bed', 2_000, 2]]),
]

test('a month is compared with the one before it, in total and per type', () => {
  const comparison = compareWithPreviousMonth(series, '2026-10')
  assert.ok(comparison)
  assert.equal(comparison.previous.month, '2026-09')
  assert.deepEqual(comparison.total, { kind: 'change', percent: (122_000 - 105_000) / 105_000 * 100, difference: 17_000 })
  assert.deepEqual(
    comparison.byType.map((row) => [row.type, row.amount, row.previousAmount, deltaDirection(row.delta)]),
    [
      ['Clinic', 90_000, 60_000, 'up'],
      ['Home', 30_000, 40_000, 'down'],
      ['Spinal Bed', 2_000, 0, 'new'],
      ['Online', 0, 5_000, 'down'], // billed in Sep only: kept as a −100% row
    ],
  )
  assert.equal(formatPercent((comparison.byType[3].delta as { percent: number }).percent), '−100%')
})

test('the first month on record has nothing to compare with', () => {
  assert.equal(compareWithPreviousMonth(series, '2026-09'), null)
})

test('an unknown month has nothing to compare with', () => {
  assert.equal(compareWithPreviousMonth(series, '2027-01'), null)
})

test('a gap month compares as a full drop, and the month after it as new', () => {
  const withGap = [series[0], month('2026-10', []), month('2026-11', [['Clinic', 1_000]])]
  const gap = compareWithPreviousMonth(withGap, '2026-10')
  assert.equal(deltaDirection(gap!.total), 'down')
  assert.equal(gap!.byType.length, 3)
  assert.ok(gap!.byType.every((row) => row.amount === 0))
  assert.equal(deltaDirection(compareWithPreviousMonth(withGap, '2026-11')!.total), 'new')
})
