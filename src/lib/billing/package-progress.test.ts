import test from 'node:test'
import assert from 'node:assert/strict'

import { getPackageProgress } from './package-progress.ts'

test('splits the bar between availed and scheduled sessions', () => {
  const progress = getPackageProgress({
    status: 'active',
    availedSessions: 4,
    scheduledSessions: 1,
    totalSessions: 7,
  })

  assert.equal(Math.round(progress.availedPct), 57)
  assert.equal(Math.round(progress.scheduledPct), 14)
  assert.equal(progress.displayStatus, 'active')
})

test('never lets the two segments overflow the bar', () => {
  const progress = getPackageProgress({
    status: 'active',
    availedSessions: 6,
    scheduledSessions: 6,
    totalSessions: 5,
  })

  assert.equal(progress.availedPct, 100)
  assert.equal(progress.scheduledPct, 0)
  assert.ok(progress.availedPct + progress.scheduledPct <= 100)
})

test('treats a zero-session package as empty rather than dividing by zero', () => {
  const progress = getPackageProgress({
    status: 'active',
    availedSessions: 0,
    scheduledSessions: 0,
    totalSessions: 0,
  })

  assert.equal(progress.availedPct, 0)
  assert.equal(progress.scheduledPct, 0)
})

test('shows a completed package with sessions left over as still active', () => {
  const progress = getPackageProgress({
    status: 'completed',
    availedSessions: 3,
    scheduledSessions: 0,
    totalSessions: 5,
  })

  assert.equal(progress.displayStatus, 'active')
})

test('keeps a genuinely finished package completed', () => {
  const progress = getPackageProgress({
    status: 'completed',
    availedSessions: 5,
    scheduledSessions: 0,
    totalSessions: 5,
  })

  assert.equal(progress.displayStatus, 'completed')
})

test('leaves a cancelled package cancelled regardless of the counts', () => {
  const progress = getPackageProgress({
    status: 'cancelled',
    availedSessions: 1,
    scheduledSessions: 0,
    totalSessions: 5,
  })

  assert.equal(progress.displayStatus, 'cancelled')
})
