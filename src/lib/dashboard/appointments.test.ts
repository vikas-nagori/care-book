import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import {
  addCalendarDays,
  CLINIC_TIME_ZONE,
  getZonedDateInterval,
  getZonedDayInterval,
} from '../timezone.ts'
import {
  filterAppointmentsInInterval,
  findNextScheduledAppointment,
  getDashboardAppointmentQueryRange,
  getDashboardAppointmentUnionRange,
} from './appointments.ts'

interface Row {
  id: string
  date: string
  time: string
  status: 'scheduled' | 'completed' | 'cancelled'
}

const midnightKolkata = new Date('2026-07-18T18:30:00.000Z')
const dashboardSource = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8')

test('midnight Kolkata excludes the previous morning appointment from the current day', () => {
  const { start, end } = getZonedDayInterval(midnightKolkata, 'Asia/Kolkata')
  const appointments: Row[] = [
    { id: 'previous-day', date: '2026-07-18', time: '11:30:00', status: 'scheduled' },
    { id: 'current-day', date: '2026-07-19', time: '11:30:00', status: 'scheduled' },
  ]

  const currentDay = filterAppointmentsInInterval(appointments, start, end)

  assert.deepEqual(currentDay.map((appointment) => appointment.id), ['current-day'])
  assert.equal(findNextScheduledAppointment(currentDay, midnightKolkata)?.id, 'current-day')
})

test('dashboard day filtering includes local midnight and excludes the next midnight', () => {
  const { start, end } = getZonedDayInterval(midnightKolkata, 'Asia/Kolkata')
  const appointments: Row[] = [
    { id: 'start', date: '2026-07-19', time: '00:00:00', status: 'scheduled' },
    { id: 'end', date: '2026-07-20', time: '00:00:00', status: 'scheduled' },
  ]

  assert.deepEqual(
    filterAppointmentsInInterval(appointments, start, end).map((appointment) => appointment.id),
    ['start'],
  )
})

test('next appointment compares absolute timestamps and returns the earliest scheduled row', () => {
  const appointments: Row[] = [
    { id: 'later', date: '2026-07-19', time: '12:30:00', status: 'scheduled' },
    { id: 'completed', date: '2026-07-19', time: '10:00:00', status: 'completed' },
    { id: 'next', date: '2026-07-19', time: '11:30:00', status: 'scheduled' },
  ]

  assert.equal(findNextScheduledAppointment(appointments, midnightKolkata)?.id, 'next')
})

test('dashboard appointment query includes the following clinic date for Up next', () => {
  assert.deepEqual(
    getDashboardAppointmentQueryRange({ startDate: '2026-07-19', endDate: '2026-07-19' }),
    { startDate: '2026-07-19', endDate: '2026-07-20' },
  )
})

test('dashboard appointment union uses the earliest start and preserves the complete clinic week', () => {
  assert.deepEqual(
    getDashboardAppointmentUnionRange(
      { startDate: '2026-07-20', endDate: '2026-07-26' },
      { startDate: '2026-07-19', endDate: '2026-07-20' },
    ),
    { startDate: '2026-07-19', endDate: '2026-07-26' },
  )
})

test('dashboard appointment union includes the following clinic date across a week boundary', () => {
  assert.deepEqual(
    getDashboardAppointmentUnionRange(
      { startDate: '2026-07-20', endDate: '2026-07-26' },
      { startDate: '2026-07-26', endDate: '2026-07-27' },
    ),
    { startDate: '2026-07-20', endDate: '2026-07-27' },
  )
})

test('Up next includes the scheduled following day across a week boundary only', () => {
  const upNextRange = getDashboardAppointmentQueryRange({
    startDate: '2026-07-26',
    endDate: '2026-07-26',
  })
  const upNextInterval = getZonedDateInterval(
    upNextRange.startDate,
    addCalendarDays(upNextRange.endDate, 1),
    CLINIC_TIME_ZONE,
  )
  const now = new Date('2026-07-26T03:30:00.000Z')
  const appointments: Row[] = [
    { id: 'following-day', date: '2026-07-27', time: '23:59:59', status: 'scheduled' },
    { id: 'later-week', date: '2026-07-28', time: '08:00:00', status: 'scheduled' },
  ]

  const upNextAppointments = filterAppointmentsInInterval(
    appointments,
    upNextInterval.start,
    upNextInterval.end,
  )

  assert.deepEqual(upNextAppointments.map((appointment) => appointment.id), ['following-day'])
  assert.equal(findNextScheduledAppointment(upNextAppointments, now)?.id, 'following-day')
})

test('dashboard source issues exactly one Supabase appointments query', () => {
  const appointmentQueries = dashboardSource.match(
    /\.from\s*\(\s*['"]appointments['"]\s*\)/g,
  ) ?? []

  assert.equal(appointmentQueries.length, 1)
  assert.doesNotMatch(dashboardSource, /\bweekCountQuery\b/)
})
