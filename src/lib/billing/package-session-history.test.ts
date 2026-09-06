import test from 'node:test'
import assert from 'node:assert/strict'
import { collapsePackageSessionHistory } from './package-session-history.ts'

const row = (id: string, appointmentReferenceId: string, lifecycle: 'scheduled' | 'availed' | 'released') =>
  ({ id, appointmentReferenceId, lifecycle })

test('collapses the released and availed ledger rows of one session into a single row', () => {
  const collapsed = collapsePackageSessionHistory([
    row('alloc-1', 'appt-1', 'released'),
    row('alloc-2', 'appt-1', 'availed'),
  ])

  assert.deepEqual(collapsed.map((entry) => entry.id), ['alloc-2'])
})

test('keeps the current allocation regardless of where the release sits in ledger order', () => {
  const collapsed = collapsePackageSessionHistory([
    row('alloc-1', 'appt-1', 'availed'),
    row('alloc-2', 'appt-1', 'released'),
  ])

  assert.deepEqual(collapsed.map((entry) => entry.id), ['alloc-1'])
})

test('keeps the last release when a session holds no current allocation', () => {
  const collapsed = collapsePackageSessionHistory([
    row('alloc-1', 'appt-1', 'released'),
    row('alloc-2', 'appt-1', 'released'),
  ])

  assert.deepEqual(collapsed.map((entry) => entry.id), ['alloc-2'])
})

test('keeps distinct sessions and preserves ledger order', () => {
  const collapsed = collapsePackageSessionHistory([
    row('alloc-1', 'appt-1', 'released'),
    row('alloc-2', 'appt-2', 'scheduled'),
    row('alloc-3', 'appt-1', 'availed'),
    row('alloc-4', 'appt-3', 'availed'),
  ])

  assert.deepEqual(collapsed.map((entry) => entry.id), ['alloc-2', 'alloc-3', 'alloc-4'])
})
