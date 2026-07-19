import assert from 'node:assert/strict'
import test from 'node:test'

import { getZonedDayInterval } from '../timezone.ts'
import {
  filterAppointmentsInInterval,
  findNextScheduledAppointment,
} from './appointments.ts'

interface Row {
  id: string
  date: string
  time: string
  status: 'scheduled' | 'completed' | 'cancelled'
}

const midnightKolkata = new Date('2026-07-18T18:30:00.000Z')

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
