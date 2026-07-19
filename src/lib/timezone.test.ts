import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addCalendarDays,
  appointmentToInstant,
  formatDateOnly,
  getClinicDateRangeForInterval,
  getZonedCalendarContext,
  getZonedDate,
  getZonedDayInterval,
  getZonedDateInterval,
  getZonedTime,
  isInstantInInterval,
  resolveTimeZone,
} from './timezone.ts'

const midnightKolkata = new Date('2026-07-18T18:30:00.000Z')

test('resolveTimeZone falls back to Kolkata for missing or invalid values', () => {
  assert.equal(resolveTimeZone(undefined), 'Asia/Kolkata')
  assert.equal(resolveTimeZone('Invalid/Zone'), 'Asia/Kolkata')
  assert.equal(resolveTimeZone('America/New_York'), 'America/New_York')
})

test('calendar day arithmetic is independent of the process timezone', () => {
  assert.equal(addCalendarDays('2026-07-19', 1), '2026-07-20')
  assert.equal(addCalendarDays('2026-03-01', -1), '2026-02-28')
})

test('zoned date and time keys honor the supplied browser timezone', () => {
  assert.equal(getZonedDate(midnightKolkata, 'Asia/Kolkata'), '2026-07-19')
  assert.equal(getZonedTime(midnightKolkata, 'Asia/Kolkata'), '00:00')
  assert.equal(getZonedDate(midnightKolkata, 'America/New_York'), '2026-07-18')
  assert.equal(getZonedTime(midnightKolkata, 'America/New_York'), '14:30')
})

test('calendar context uses Monday weeks and calendar month boundaries', () => {
  assert.deepEqual(getZonedCalendarContext(midnightKolkata, 'Asia/Kolkata'), {
    date: '2026-07-19',
    time: '00:00',
    weekStart: '2026-07-13',
    weekEnd: '2026-07-19',
    monthStart: '2026-07-01',
    monthEnd: '2026-07-31',
    previousMonthStart: '2026-06-01',
    previousMonthEnd: '2026-06-30',
    monthLabel: 'July 2026',
    previousMonthLabel: 'June',
  })
})

test('a New York user day maps to both overlapping Kolkata clinic dates', () => {
  const { start, end } = getZonedDayInterval(midnightKolkata, 'America/New_York')

  assert.equal(start.toISOString(), '2026-07-18T04:00:00.000Z')
  assert.equal(end.toISOString(), '2026-07-19T04:00:00.000Z')
  assert.deepEqual(getClinicDateRangeForInterval(start, end), {
    startDate: '2026-07-18',
    endDate: '2026-07-19',
  })
})

test('zoned date ranges convert calendar boundaries to absolute timestamps', () => {
  const { start, end } = getZonedDateInterval(
    '2026-07-13',
    '2026-07-20',
    'Asia/Kolkata',
  )

  assert.equal(start.toISOString(), '2026-07-12T18:30:00.000Z')
  assert.equal(end.toISOString(), '2026-07-19T18:30:00.000Z')
})

test('zoned date ranges start at the first representable instant after a midnight DST jump', () => {
  const { start, end } = getZonedDateInterval(
    '2026-09-06',
    '2026-09-07',
    'America/Santiago',
  )

  assert.equal(start.toISOString(), '2026-09-06T04:00:00.000Z')
  assert.equal(getZonedDate(start, 'America/Santiago'), '2026-09-06')
  assert.equal(end.toISOString(), '2026-09-07T03:00:00.000Z')
})

test('clinic wall-clock appointments convert to absolute timestamps', () => {
  assert.equal(
    appointmentToInstant('2026-07-18', '11:30:00').toISOString(),
    '2026-07-18T06:00:00.000Z',
  )
})

test('timestamp intervals include their start and exclude their end', () => {
  const start = new Date('2026-07-18T04:00:00.000Z')
  const end = new Date('2026-07-19T04:00:00.000Z')

  assert.equal(isInstantInInterval(start, start, end), true)
  assert.equal(isInstantInInterval(new Date(end.getTime() - 1), start, end), true)
  assert.equal(isInstantInInterval(end, start, end), false)
})

test('date-only formatting never shifts the stored calendar date', () => {
  assert.equal(formatDateOnly('2026-07-18', 'dd MMM yyyy'), '18 Jul 2026')
  assert.equal(formatDateOnly('2026-07-18', 'EEEE, dd MMM yyyy'), 'Saturday, 18 Jul 2026')
})
