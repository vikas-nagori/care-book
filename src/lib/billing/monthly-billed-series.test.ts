import assert from 'node:assert/strict'
import test from 'node:test'

import { buildMonthlyBilledSeries, type BilledSessionDate } from './monthly-billed-series.ts'

test('sums fees per calendar month', () => {
  const sessions: BilledSessionDate[] = [
    { date: '2026-05-02', fee: 800 },
    { date: '2026-05-20', fee: 1000 },
    { date: '2026-06-11', fee: 500 },
  ]
  const series = buildMonthlyBilledSeries(sessions, '2026-06')
  assert.deepEqual(
    series.map((p) => ({ month: p.month, amount: p.amount })),
    [
      { month: '2026-05', amount: 1800 },
      { month: '2026-06', amount: 500 },
    ],
  )
})

test('fills gap months with 0 between inception and current month', () => {
  const series = buildMonthlyBilledSeries(
    [
      { date: '2026-01-15', fee: 800 },
      { date: '2026-04-15', fee: 1200 },
    ],
    '2026-04',
  )
  assert.deepEqual(
    series.map((p) => p.amount),
    [800, 0, 0, 1200],
  )
  assert.deepEqual(
    series.map((p) => p.month),
    ['2026-01', '2026-02', '2026-03', '2026-04'],
  )
})

test('extends through the current month even when it has no billing', () => {
  const series = buildMonthlyBilledSeries([{ date: '2026-05-02', fee: 800 }], '2026-07')
  assert.deepEqual(
    series.map((p) => ({ month: p.month, amount: p.amount })),
    [
      { month: '2026-05', amount: 800 },
      { month: '2026-06', amount: 0 },
      { month: '2026-07', amount: 0 },
    ],
  )
})

test('spans across a year boundary', () => {
  const series = buildMonthlyBilledSeries(
    [
      { date: '2025-11-01', fee: 300 },
      { date: '2026-02-01', fee: 400 },
    ],
    '2026-02',
  )
  assert.deepEqual(
    series.map((p) => p.month),
    ['2025-11', '2025-12', '2026-01', '2026-02'],
  )
  assert.equal(series[0].label, "Nov '25")
})

test('includes months later than the current month when data extends past it', () => {
  const series = buildMonthlyBilledSeries([{ date: '2026-09-01', fee: 500 }], '2026-07')
  assert.deepEqual(
    series.map((p) => p.month),
    ['2026-07', '2026-08', '2026-09'],
  )
})

test('treats null/non-finite fees as 0 without dropping the month', () => {
  const series = buildMonthlyBilledSeries(
    [
      { date: '2026-05-02', fee: null },
      { date: '2026-05-03', fee: Number.NaN },
      { date: '2026-05-04', fee: 800 },
    ],
    '2026-05',
  )
  assert.deepEqual(series, [{ month: '2026-05', label: "May '26", amount: 800 }])
})

test('returns an empty series when there are no sessions', () => {
  assert.deepEqual(buildMonthlyBilledSeries([], '2026-07'), [])
})
