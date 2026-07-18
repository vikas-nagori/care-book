import assert from 'node:assert/strict'
import test from 'node:test'

import { buildScheduleRailDates, resolveScheduleDateRange } from './date-range.ts'

test('resolveScheduleDateRange accepts a strict real YYYY-MM-DD date', () => {
  const result = resolveScheduleDateRange(
    '2024-02-29',
    new Date('2026-07-18T12:00:00.000Z')
  )

  assert.equal(result.selectedDate, '2024-02-29')
  assert.equal(result.rangeStart, '2024-02-08')
  assert.equal(result.rangeEnd, '2024-03-21')
})

test('resolveScheduleDateRange falls back to the current Kolkata date for missing or invalid input', () => {
  const now = new Date('2026-01-01T18:30:00.000Z')
  const invalidInputs = [
    undefined,
    '2026-02-29',
    '2024-02-30',
    '2024-2-29',
    '2024-02-29T00:00:00Z',
    ['2024-02-29'],
  ]

  for (const input of invalidInputs) {
    assert.equal(resolveScheduleDateRange(input, now).selectedDate, '2026-01-02')
  }
})

test('buildScheduleRailDates returns the inclusive selected date plus or minus 21 days', () => {
  const dates = buildScheduleRailDates('2026-01-15')

  assert.equal(dates.length, 43)
  assert.equal(dates[0], '2025-12-25')
  assert.equal(dates[21], '2026-01-15')
  assert.equal(dates[42], '2026-02-05')
  assert.equal(new Set(dates).size, 43)
})

test('resolveScheduleDateRange includes the same 43 dates used by its query range', () => {
  const result = resolveScheduleDateRange('2026-12-20')

  assert.deepEqual(result.railDates, buildScheduleRailDates('2026-12-20'))
  assert.equal(result.rangeStart, result.railDates[0])
  assert.equal(result.rangeEnd, result.railDates[42])
})
