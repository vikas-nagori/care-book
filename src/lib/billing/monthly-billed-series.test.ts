import assert from 'node:assert/strict'
import test from 'node:test'

import { buildMonthlyBilledSeries, type BilledMonthBucket } from './monthly-billed-series.ts'

const bucket = (month: string, type: string | null, amount: number, sessionCount = 1): BilledMonthBucket => ({
  month,
  type,
  amount,
  sessionCount,
})

test('sums every type bucket into that month total', () => {
  const series = buildMonthlyBilledSeries(
    [bucket('2026-05', 'Clinic', 800, 2), bucket('2026-05', 'Home', 1000, 1), bucket('2026-06', 'Clinic', 500, 1)],
    '2026-06',
  )

  assert.deepEqual(
    series.map((p) => ({ month: p.month, amount: p.amount })),
    [
      { month: '2026-05', amount: 1800 },
      { month: '2026-06', amount: 500 },
    ],
  )
})

test('carries a per-appointment-type breakdown on each month', () => {
  const series = buildMonthlyBilledSeries(
    [bucket('2026-05', 'Clinic', 800, 2), bucket('2026-05', 'Home', 1000, 3)],
    '2026-05',
  )

  assert.deepEqual(series[0].breakdown, [
    { type: 'Home', amount: 1000, count: 3 },
    { type: 'Clinic', amount: 800, count: 2 },
  ])
})

test('orders a breakdown by amount descending, then type name', () => {
  const series = buildMonthlyBilledSeries(
    [bucket('2026-05', 'Online', 500), bucket('2026-05', 'Clinic', 500), bucket('2026-05', 'Home', 900)],
    '2026-05',
  )

  assert.deepEqual(series[0].breakdown.map((row) => row.type), ['Home', 'Clinic', 'Online'])
})

test('collapses a null or blank type into one Untyped bucket', () => {
  const series = buildMonthlyBilledSeries(
    [bucket('2026-05', null, 300, 1), bucket('2026-05', '  ', 200, 1)],
    '2026-05',
  )

  assert.deepEqual(series[0].breakdown, [{ type: 'Untyped', amount: 500, count: 2 }])
})

test('fills gap months with 0 and an empty breakdown', () => {
  const series = buildMonthlyBilledSeries(
    [bucket('2026-01', 'Clinic', 800), bucket('2026-04', 'Clinic', 1200)],
    '2026-04',
  )

  assert.deepEqual(series.map((p) => p.month), ['2026-01', '2026-02', '2026-03', '2026-04'])
  assert.deepEqual(series.map((p) => p.amount), [800, 0, 0, 1200])
  assert.deepEqual(series[1].breakdown, [])
})

test('extends through the current month even when it has no billing', () => {
  const series = buildMonthlyBilledSeries([bucket('2026-05', 'Clinic', 800)], '2026-07')

  assert.deepEqual(series.map((p) => p.month), ['2026-05', '2026-06', '2026-07'])
})

test('includes months later than the current month when data extends past it', () => {
  const series = buildMonthlyBilledSeries([bucket('2026-09', 'Clinic', 500)], '2026-07')

  assert.deepEqual(series.map((p) => p.month), ['2026-07', '2026-08', '2026-09'])
})

test('spans a year boundary and labels the month short', () => {
  const series = buildMonthlyBilledSeries(
    [bucket('2025-11', 'Clinic', 300), bucket('2026-02', 'Clinic', 400)],
    '2026-02',
  )

  assert.deepEqual(series.map((p) => p.month), ['2025-11', '2025-12', '2026-01', '2026-02'])
  assert.equal(series[0].label, "Nov '25")
})

test('treats null and non-numeric amounts as 0 without dropping the month', () => {
  const series = buildMonthlyBilledSeries(
    [bucket('2026-05', 'Clinic', null as unknown as number, 1), bucket('2026-05', 'Home', 800, 1)],
    '2026-05',
  )

  assert.equal(series[0].amount, 800)
})

test('reads numeric amounts delivered as strings', () => {
  const series = buildMonthlyBilledSeries(
    [{ month: '2026-05', type: 'Clinic', amount: '1250.00', sessionCount: '3' }],
    '2026-05',
  )

  assert.equal(series[0].amount, 1250)
  assert.deepEqual(series[0].breakdown, [{ type: 'Clinic', amount: 1250, count: 3 }])
})

test('returns an empty series when there are no buckets', () => {
  assert.deepEqual(buildMonthlyBilledSeries([], '2026-07'), [])
})
