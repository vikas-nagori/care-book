import test from 'node:test'
import assert from 'node:assert/strict'

import { countScheduleAppointmentsOnDate, isCountedScheduleStatus } from './appointment-counts.ts'

const appointments = [
  { date: '2026-08-15', status: 'scheduled' },
  { date: '2026-08-15', status: 'completed' },
  { date: '2026-08-15', status: 'cancelled' },
  { date: '2026-08-16', status: 'scheduled' },
]

test('counts scheduled and completed appointments on the date', () => {
  assert.equal(countScheduleAppointmentsOnDate(appointments, '2026-08-15'), 2)
})

test('excludes cancelled appointments from the date-strip count', () => {
  const allCancelled = [
    { date: '2026-08-15', status: 'cancelled' },
    { date: '2026-08-15', status: 'cancelled' },
  ]

  assert.equal(countScheduleAppointmentsOnDate(allCancelled, '2026-08-15'), 0)
})

test('ignores appointments on other dates', () => {
  assert.equal(countScheduleAppointmentsOnDate(appointments, '2026-08-16'), 1)
  assert.equal(countScheduleAppointmentsOnDate(appointments, '2026-08-17'), 0)
})

test('does not count rows with a missing or unknown status', () => {
  assert.equal(isCountedScheduleStatus(undefined), false)
  assert.equal(isCountedScheduleStatus(null), false)
  assert.equal(isCountedScheduleStatus('no_show'), false)
  assert.equal(isCountedScheduleStatus('scheduled'), true)
  assert.equal(isCountedScheduleStatus('completed'), true)
  assert.equal(isCountedScheduleStatus('cancelled'), false)
})
