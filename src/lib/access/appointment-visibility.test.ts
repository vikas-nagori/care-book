import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canViewAppointmentForProfile,
  getAppointmentVisibilityFilter,
} from './appointment-visibility.ts'
import type { Appointment, Profile } from '../supabase/types.ts'

const staffProfile: Pick<Profile, 'id' | 'role'> = {
  id: '00000000-0000-0000-0000-000000000001',
  role: 'staff',
}

const adminProfile: Pick<Profile, 'id' | 'role'> = {
  id: '00000000-0000-0000-0000-000000000002',
  role: 'admin',
}

function appointment(
  overrides: Partial<Pick<Appointment, 'type_is_shared' | 'created_by' | 'assigned_to'>> = {},
): Pick<Appointment, 'type_is_shared' | 'created_by' | 'assigned_to'> {
  return {
    type_is_shared: false,
    created_by: null,
    assigned_to: null,
    ...overrides,
  }
}

test('admins can view every appointment type', () => {
  assert.equal(canViewAppointmentForProfile(appointment({ type_is_shared: true }), adminProfile), true)
  assert.equal(canViewAppointmentForProfile(appointment({ type_is_shared: false }), adminProfile), true)
})

test('staff can view shared appointments', () => {
  assert.equal(canViewAppointmentForProfile(appointment({ type_is_shared: true }), staffProfile), true)
})

test('staff can view restricted appointments they created', () => {
  assert.equal(
    canViewAppointmentForProfile(
      appointment({ created_by: staffProfile.id }),
      staffProfile,
    ),
    true,
  )
})

test('staff can view restricted appointments assigned to them', () => {
  assert.equal(
    canViewAppointmentForProfile(
      appointment({ assigned_to: staffProfile.id }),
      staffProfile,
    ),
    true,
  )
})

test('staff cannot view unrelated restricted appointments', () => {
  assert.equal(
    canViewAppointmentForProfile(
      appointment({
        created_by: '00000000-0000-0000-0000-000000000003',
        assigned_to: '00000000-0000-0000-0000-000000000004',
      }),
      staffProfile,
    ),
    false,
  )
})

test('appointment visibility filter limits staff to shared and owned appointments', () => {
  assert.equal(
    getAppointmentVisibilityFilter(staffProfile),
    `type_is_shared.eq.true,created_by.eq.${staffProfile.id},assigned_to.eq.${staffProfile.id}`,
  )
})

test('appointment visibility filter does not restrict admins', () => {
  assert.equal(getAppointmentVisibilityFilter(adminProfile), null)
})
