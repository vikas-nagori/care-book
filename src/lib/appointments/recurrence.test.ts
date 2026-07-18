import assert from 'node:assert/strict'
import test from 'node:test'

import { generateRecurringAppointmentDates } from './recurrence.ts'

test('includes the start date when its weekday is selected', () => {
  assert.deepEqual(
    generateRecurringAppointmentDates({
      startDate: '2026-07-20',
      weekdays: [1],
      totalSessions: 3,
    }),
    ['2026-07-20', '2026-07-27', '2026-08-03'],
  )
})

test('uses the first selected weekday after a non-matching start boundary', () => {
  assert.deepEqual(
    generateRecurringAppointmentDates({
      startDate: '2026-07-21',
      weekdays: [1, 4],
      totalSessions: 4,
    }),
    ['2026-07-23', '2026-07-27', '2026-07-30', '2026-08-03'],
  )
})

test('normalizes repeated unordered weekdays into chronological unique dates', () => {
  assert.deepEqual(
    generateRecurringAppointmentDates({
      startDate: '2026-07-20',
      weekdays: [5, 1, 3, 1],
      totalSessions: 6,
    }),
    ['2026-07-20', '2026-07-22', '2026-07-24', '2026-07-27', '2026-07-29', '2026-07-31'],
  )
})

test('supports the one-session and one-hundred-session boundaries', () => {
  assert.deepEqual(
    generateRecurringAppointmentDates({
      startDate: '2026-07-20',
      weekdays: [1],
      totalSessions: 1,
    }),
    ['2026-07-20'],
  )

  const dates = generateRecurringAppointmentDates({
    startDate: '2026-07-20',
    weekdays: [1, 3, 5],
    totalSessions: 100,
  })
  assert.equal(dates.length, 100)
  assert.equal(new Set(dates).size, 100)
  assert.deepEqual(dates, [...dates].sort())
})

test('rejects missing or invalid weekdays', () => {
  assert.throws(
    () => generateRecurringAppointmentDates({ startDate: '2026-07-20', weekdays: [], totalSessions: 1 }),
    /weekday/i,
  )
  assert.throws(
    () => generateRecurringAppointmentDates({ startDate: '2026-07-20', weekdays: [-1], totalSessions: 1 }),
    /weekday/i,
  )
  assert.throws(
    () => generateRecurringAppointmentDates({ startDate: '2026-07-20', weekdays: [1.5], totalSessions: 1 }),
    /weekday/i,
  )
  assert.throws(
    () => generateRecurringAppointmentDates({ startDate: '2026-07-20', weekdays: [7], totalSessions: 1 }),
    /weekday/i,
  )
})

test('rejects invalid or nonexistent start dates', () => {
  for (const startDate of ['', '20-07-2026', '2026-02-30', 'not-a-date']) {
    assert.throws(
      () => generateRecurringAppointmentDates({ startDate, weekdays: [1], totalSessions: 1 }),
      /start date/i,
    )
  }
})

test('rejects session counts outside the integer range from one to one hundred', () => {
  for (const totalSessions of [0, -1, 1.5, 101, Number.NaN]) {
    assert.throws(
      () => generateRecurringAppointmentDates({ startDate: '2026-07-20', weekdays: [1], totalSessions }),
      /session/i,
    )
  }
})
