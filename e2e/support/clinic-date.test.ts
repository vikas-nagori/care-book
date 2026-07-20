import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clinicDate } from './clinic-date.ts'

test('clinicDate uses the Asia/Kolkata calendar date near midnight IST', () => {
  const halfPastMidnightIst = new Date('2026-07-19T19:00:00.000Z')

  assert.equal(clinicDate(0, halfPastMidnightIst), '2026-07-20')
  assert.equal(clinicDate(-1, halfPastMidnightIst), '2026-07-19')
})
