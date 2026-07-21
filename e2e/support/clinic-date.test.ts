import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clinicDate, upcomingClinicSlot } from './clinic-date.ts'

test('clinicDate uses the Asia/Kolkata calendar date near midnight IST', () => {
  const halfPastMidnightIst = new Date('2026-07-19T19:00:00.000Z')

  assert.equal(clinicDate(0, halfPastMidnightIst), '2026-07-20')
  assert.equal(clinicDate(-1, halfPastMidnightIst), '2026-07-19')
})

test('upcomingClinicSlot rolls a future fixture across the clinic-day boundary', () => {
  const oneMinuteBeforeMidnightIst = new Date('2026-07-19T18:29:00.000Z')

  assert.deepEqual(upcomingClinicSlot(oneMinuteBeforeMidnightIst), {
    date: '2026-07-20',
    time: '05:59',
  })
})
