import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isReminderOverdue, selectDashboardReminders } from './dashboard.ts'

const base = { status: 'pending' as const, time: null, created_at: '2026-09-01T00:00:00Z' }

test('keeps pending reminders dated today or earlier and drops completed and future ones', () => {
  const rows = [
    { ...base, id: 'future', date: '2026-09-06' },
    { ...base, id: 'done', date: '2026-09-05', status: 'completed' as const },
    { ...base, id: 'today', date: '2026-09-05' },
    { ...base, id: 'old', date: '2026-09-01' },
  ]
  assert.deepEqual(selectDashboardReminders(rows, '2026-09-05').map(row => row.id), ['old', 'today'])
})

test('orders by date, then untimed before timed, then creation within a date', () => {
  const rows = [
    { ...base, id: 'b', date: '2026-09-05', time: '10:00:00' },
    { ...base, id: 'c', date: '2026-09-05', time: null, created_at: '2026-09-02T00:00:00Z' },
    { ...base, id: 'a', date: '2026-09-05', time: null },
    { ...base, id: 'd', date: '2026-09-04', time: '15:00:00' },
  ]
  assert.deepEqual(selectDashboardReminders(rows, '2026-09-05').map(row => row.id), ['d', 'a', 'c', 'b'])
})

test('does not mutate the input', () => {
  const rows = [{ ...base, id: 'b', date: '2026-09-04' }, { ...base, id: 'a', date: '2026-09-03' }]
  selectDashboardReminders(rows, '2026-09-05')
  assert.deepEqual(rows.map(row => row.id), ['b', 'a'])
})

test('flags only earlier dates as overdue', () => {
  assert.equal(isReminderOverdue({ date: '2026-09-04' }, '2026-09-05'), true)
  assert.equal(isReminderOverdue({ date: '2026-09-05' }, '2026-09-05'), false)
  assert.equal(isReminderOverdue({ date: '2026-09-06' }, '2026-09-05'), false)
})
