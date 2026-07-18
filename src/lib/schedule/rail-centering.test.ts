import assert from 'node:assert/strict'
import test from 'node:test'

import { getScheduleRailCenteringBehavior } from './date-range.ts'

const visibleState = {
  railIsVisible: true,
  chipIsVisible: true,
  selectedDate: '2026-07-19',
  lastCenteredDate: '2026-07-18',
  railWidth: 390,
  lastRailWidth: 390,
  wasVisible: true,
  prefersReducedMotion: false,
}

test('rail centering policy skips hidden or unchanged layouts', () => {
  assert.equal(getScheduleRailCenteringBehavior({ ...visibleState, railIsVisible: false }), null)
  assert.equal(getScheduleRailCenteringBehavior({ ...visibleState, chipIsVisible: false }), null)
  assert.equal(getScheduleRailCenteringBehavior({
    ...visibleState,
    lastCenteredDate: visibleState.selectedDate,
  }), null)
})

test('rail centering policy animates only later visible date transitions with motion allowed', () => {
  assert.equal(getScheduleRailCenteringBehavior(visibleState), 'smooth')
  assert.equal(getScheduleRailCenteringBehavior({ ...visibleState, lastCenteredDate: null }), 'auto')
  assert.equal(getScheduleRailCenteringBehavior({ ...visibleState, wasVisible: false }), 'auto')
  assert.equal(getScheduleRailCenteringBehavior({
    ...visibleState,
    prefersReducedMotion: true,
  }), 'auto')
  assert.equal(getScheduleRailCenteringBehavior({
    ...visibleState,
    lastCenteredDate: visibleState.selectedDate,
    railWidth: 360,
  }), 'auto')
})
