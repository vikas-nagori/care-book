import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAppointmentAssignee } from './appointment-assignee.ts'

const inputs = (overrides: Partial<Parameters<typeof resolveAppointmentAssignee>[0]> = {}) => ({
  typeIsShared: false,
  explicitAssigneeId: null,
  explicitExternalStaffId: null,
  bookingUserId: 'booking-user',
  ...overrides,
})

test('an unnamed booking falls to whoever is booking it', () => {
  assert.deepEqual(resolveAppointmentAssignee(inputs()), {
    assignedTo: 'booking-user',
    externalStaffId: null,
    defaultedToBookingUser: true,
  })
})

test('an explicitly named staff member wins over the booking user', () => {
  assert.deepEqual(resolveAppointmentAssignee(inputs({ explicitAssigneeId: 'other-physio' })), {
    assignedTo: 'other-physio',
    externalStaffId: null,
    defaultedToBookingUser: false,
  })
})

test('an external staff member wins and leaves no internal assignee', () => {
  assert.deepEqual(resolveAppointmentAssignee(inputs({ explicitExternalStaffId: 'ext-1' })), {
    assignedTo: null,
    externalStaffId: 'ext-1',
    defaultedToBookingUser: false,
  })
})

test('a shared appointment type stays unassigned', () => {
  // Shared types are visible clinic-wide; assigning one would narrow who can see it.
  assert.deepEqual(resolveAppointmentAssignee(inputs({ typeIsShared: true })), {
    assignedTo: null,
    externalStaffId: null,
    defaultedToBookingUser: false,
  })
})

test('a shared type ignores an explicitly named assignee too', () => {
  assert.deepEqual(resolveAppointmentAssignee(inputs({ typeIsShared: true, explicitAssigneeId: 'other-physio' })), {
    assignedTo: null,
    externalStaffId: null,
    defaultedToBookingUser: false,
  })
})
