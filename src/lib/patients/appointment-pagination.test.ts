import assert from 'node:assert/strict'
import test from 'node:test'

import { getPaginationItems, parseAppointmentPage } from './appointment-pagination.ts'

test('parses positive integer page parameters and falls back to page one', () => {
  assert.equal(parseAppointmentPage('3'), 3)
  for (const value of [undefined, '', '0', '-1', '1.5', 'abc']) {
    assert.equal(parseAppointmentPage(value), 1)
  }
})

test('shows every page when the page count is compact', () => {
  assert.deepEqual(getPaginationItems(1, 1), [1])
  assert.deepEqual(getPaginationItems(3, 6), [1, 2, 3, 4, 5, 6])
})

test('uses a compact page window near the beginning, middle, and end', () => {
  assert.deepEqual(getPaginationItems(1, 10), [1, 2, 3, 'ellipsis', 10])
  assert.deepEqual(getPaginationItems(5, 10), [1, 'ellipsis', 4, 5, 6, 'ellipsis', 10])
  assert.deepEqual(getPaginationItems(10, 10), [1, 'ellipsis', 8, 9, 10])
})

test('clamps the current page before building navigation items', () => {
  assert.deepEqual(getPaginationItems(99, 4), [1, 2, 3, 4])
  assert.deepEqual(getPaginationItems(-5, 10), [1, 2, 3, 'ellipsis', 10])
})
