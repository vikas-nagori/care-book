import assert from 'node:assert/strict'
import test from 'node:test'
import { groupMetricRowsByDate, paginateDateGroups } from './date-grouped-records.ts'

const row = (id: string, date: string, amount: number) => ({ id, date, title: 'Patient', amount })

test('groups rows sharing a date into one group carrying its own total', () => {
  const groups = groupMetricRowsByDate([
    row('a', '2026-09-18', 600),
    row('b', '2026-09-18', 650),
    row('c', '2026-09-17', 750),
  ])

  assert.equal(groups.length, 2)
  assert.equal(groups[0].date, '2026-09-18')
  assert.equal(groups[0].total, 1250)
  assert.equal(groups[0].count, 2)
  assert.deepEqual(groups[0].rows.map((r) => r.id), ['a', 'b'])
})

test('orders groups newest date first', () => {
  const groups = groupMetricRowsByDate([
    row('a', '2026-09-02', 100),
    row('b', '2026-09-21', 200),
    row('c', '2026-09-11', 300),
  ])

  assert.deepEqual(groups.map((g) => g.date), ['2026-09-21', '2026-09-11', '2026-09-02'])
})

test('preserves the incoming row order within a date', () => {
  const groups = groupMetricRowsByDate([
    row('second', '2026-09-18', 1),
    row('first', '2026-09-18', 2),
  ])

  assert.deepEqual(groups[0].rows.map((r) => r.id), ['second', 'first'])
})

test('nets refunds against payments so a date total can go negative', () => {
  const groups = groupMetricRowsByDate([
    row('payment', '2026-09-18', 500),
    row('refund', '2026-09-18', -800),
  ])

  assert.equal(groups[0].total, -300)
  assert.equal(groups[0].count, 2)
})

test('labels each group with a short day-and-month label', () => {
  const groups = groupMetricRowsByDate([row('a', '2026-09-18', 600)])

  assert.equal(groups[0].label, '18 Sep')
})

test('returns no groups for no rows', () => {
  assert.deepEqual(groupMetricRowsByDate([]), [])
})

test('paginates whole date groups so a date never splits across pages', () => {
  const groups = groupMetricRowsByDate([
    row('a', '2026-09-03', 1),
    row('b', '2026-09-02', 1),
    row('c', '2026-09-02', 1),
    row('d', '2026-09-01', 1),
  ])

  const page = paginateDateGroups(groups, { page: 2, pageSize: 2 })

  assert.deepEqual(page.groups.map((g) => g.date), ['2026-09-01'])
  assert.equal(page.totalPages, 2)
})

test('reports a single page when there are no groups at all', () => {
  const page = paginateDateGroups([], { page: 1, pageSize: 15 })

  assert.deepEqual(page.groups, [])
  assert.equal(page.totalPages, 1)
})
