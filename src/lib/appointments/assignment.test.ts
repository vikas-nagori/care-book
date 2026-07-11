import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeAppointmentAssignment, parseStaffAssignmentValue } from './assignment.ts'

test('normalizeAppointmentAssignment clears assignment fields for shared appointments', () => {
  assert.deepEqual(
    normalizeAppointmentAssignment({
      isShared: true,
      assignedTo: 'profile-1',
      externalStaffId: 'external-1',
    }),
    {
      assigned_to: null,
      external_staff_id: null,
    },
  )
})

test('normalizeAppointmentAssignment keeps internal assignment for restricted types', () => {
  assert.deepEqual(
    normalizeAppointmentAssignment({
      isShared: false,
      assignedTo: 'profile-1',
      externalStaffId: '',
    }),
    {
      assigned_to: 'profile-1',
      external_staff_id: null,
    },
  )
})

test('normalizeAppointmentAssignment keeps external assignment and clears internal assignment', () => {
  assert.deepEqual(
    normalizeAppointmentAssignment({
      isShared: false,
      assignedTo: 'profile-1',
      externalStaffId: 'external-1',
    }),
    {
      assigned_to: null,
      external_staff_id: 'external-1',
    },
  )
})

test('parseStaffAssignmentValue maps unified internal values to assigned_to', () => {
  assert.deepEqual(parseStaffAssignmentValue('internal:profile-1'), {
    assignedTo: 'profile-1',
    externalStaffId: null,
  })
})

test('parseStaffAssignmentValue maps unified external values to external_staff_id', () => {
  assert.deepEqual(parseStaffAssignmentValue('external:staff-1'), {
    assignedTo: null,
    externalStaffId: 'staff-1',
  })
})

test('parseStaffAssignmentValue maps unassigned or malformed values to no assignment', () => {
  assert.deepEqual(parseStaffAssignmentValue('__unassigned__'), {
    assignedTo: null,
    externalStaffId: null,
  })
  assert.deepEqual(parseStaffAssignmentValue('internal:'), {
    assignedTo: null,
    externalStaffId: null,
  })
  assert.deepEqual(parseStaffAssignmentValue('unexpected:staff-1'), {
    assignedTo: null,
    externalStaffId: null,
  })
})
