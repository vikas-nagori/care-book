import assert from 'node:assert/strict'
import test from 'node:test'

import { getScheduleDateNavigation } from './date-range.ts'

test('schedule date navigation creates a history-preserving route descriptor', () => {
  assert.deepEqual(getScheduleDateNavigation('2026-07-19'), {
    href: '/schedule?date=2026-07-19',
    options: { scroll: false },
  })
})
