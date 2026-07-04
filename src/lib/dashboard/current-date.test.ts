import assert from 'node:assert/strict'
import test from 'node:test'

import { formatDashboardDate } from './current-date.ts'

test('formatDashboardDate respects the requested timezone when formatting the dashboard label', () => {
  const date = new Date('2026-01-01T00:30:00.000Z')

  assert.equal(formatDashboardDate(date, 'UTC'), 'Thursday, 01 Jan 2026')
  assert.equal(
    formatDashboardDate(date, 'America/Los_Angeles'),
    'Wednesday, 31 Dec 2025'
  )
})

test('formatDashboardDate falls back to UTC when the timezone is invalid', () => {
  const date = new Date('2026-01-01T00:30:00.000Z')

  assert.equal(formatDashboardDate(date, 'Invalid/Timezone'), 'Thursday, 01 Jan 2026')
})
