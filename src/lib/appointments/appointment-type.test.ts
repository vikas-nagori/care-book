import assert from 'node:assert/strict'
import test from 'node:test'

import {
  defaultAppointmentType,
  sortAppointmentTypes,
  validateAppointmentTypeInput,
} from './appointment-type.ts'
import type { AppointmentType } from '../supabase/types.ts'

function type(overrides: Partial<AppointmentType>): AppointmentType {
  return {
    id: 'id',
    clinic_id: 'clinic',
    name: 'Type',
    session_rate: 0,
    is_shared: false,
    is_default: false,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

test('sortAppointmentTypes orders by sort_order then name', () => {
  const sorted = sortAppointmentTypes([
    type({ id: 'b', name: 'Home Visit', sort_order: 1 }),
    type({ id: 'a', name: 'Clinic Visit', sort_order: 0 }),
    type({ id: 'c', name: 'Aqua', sort_order: 1 }),
  ])
  assert.deepEqual(sorted.map((t) => t.id), ['a', 'c', 'b'])
})

test('defaultAppointmentType prefers the first shared type', () => {
  const chosen = defaultAppointmentType([
    type({ id: 'home', is_shared: false, sort_order: 0 }),
    type({ id: 'clinic', is_shared: true, sort_order: 1 }),
  ])
  assert.equal(chosen?.id, 'clinic')
})

test('defaultAppointmentType falls back to the first by sort order when none shared', () => {
  const chosen = defaultAppointmentType([
    type({ id: 'second', is_shared: false, sort_order: 1 }),
    type({ id: 'first', is_shared: false, sort_order: 0 }),
  ])
  assert.equal(chosen?.id, 'first')
})

test('defaultAppointmentType returns null for an empty list', () => {
  assert.equal(defaultAppointmentType([]), null)
})

test('validateAppointmentTypeInput trims a valid input', () => {
  assert.deepEqual(
    validateAppointmentTypeInput({ name: '  Clinic Visit  ', sessionRate: 800, isShared: true }),
    { success: true, values: { name: 'Clinic Visit', sessionRate: 800, isShared: true } },
  )
})

test('validateAppointmentTypeInput requires a name', () => {
  const result = validateAppointmentTypeInput({ name: '   ', sessionRate: 800, isShared: true })
  assert.equal(result.success, false)
  assert.equal((result as { errorCode: string }).errorCode, 'APPOINTMENT_TYPE_NAME_REQUIRED')
})

test('validateAppointmentTypeInput rejects a negative rate', () => {
  const result = validateAppointmentTypeInput({ name: 'Clinic', sessionRate: -1, isShared: false })
  assert.equal(result.success, false)
  assert.equal((result as { errorCode: string }).errorCode, 'APPOINTMENT_TYPE_INVALID_RATE')
})
