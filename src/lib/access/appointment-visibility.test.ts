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
  overrides: Partial<Pick<Appointment, 'type' | 'created_by' | 'assigned_to'>> = {},
): Pick<Appointment, 'type' | 'created_by' | 'assigned_to'> {
  return {
    type: 'home_visit',
    created_by: null,
    assigned_to: null,
    ...overrides,
  }
}

test('admins can view every appointment type', () => {
  assert.equal(canViewAppointmentForProfile(appointment({ type: 'clinic' }), adminProfile), true)
  assert.equal(canViewAppointmentForProfile(appointment({ type: 'home_visit' }), adminProfile), true)
})

test('staff can view clinic appointments', () => {
  assert.equal(canViewAppointmentForProfile(appointment({ type: 'clinic' }), staffProfile), true)
})

test('staff can view home visits they created', () => {
  assert.equal(
    canViewAppointmentForProfile(
      appointment({ created_by: staffProfile.id }),
      staffProfile,
    ),
    true,
  )
})

test('staff can view home visits assigned to them', () => {
  assert.equal(
    canViewAppointmentForProfile(
      appointment({ assigned_to: staffProfile.id }),
      staffProfile,
    ),
    true,
  )
})

test('staff cannot view unrelated home visits', () => {
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

test('clinic home visits are restricted to creator/assignee like personal home visits', () => {
  // Unrelated clinic home visit: not visible to staff.
  assert.equal(
    canViewAppointmentForProfile(
      appointment({
        type: 'clinic_home_visit',
        created_by: '00000000-0000-0000-0000-000000000003',
        assigned_to: '00000000-0000-0000-0000-000000000004',
      }),
      staffProfile,
    ),
    false,
  )
  // Assigned clinic home visit: visible to that staff member.
  assert.equal(
    canViewAppointmentForProfile(
      appointment({ type: 'clinic_home_visit', assigned_to: staffProfile.id }),
      staffProfile,
    ),
    true,
  )
})

test('appointment visibility filter limits staff to clinic and owned home visits', () => {
  assert.equal(
    getAppointmentVisibilityFilter(staffProfile),
    `type.eq.clinic,created_by.eq.${staffProfile.id},assigned_to.eq.${staffProfile.id}`,
  )
})

test('appointment visibility filter does not restrict admins', () => {
  assert.equal(getAppointmentVisibilityFilter(adminProfile), null)
})
