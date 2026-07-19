import assert from 'node:assert/strict'
import test from 'node:test'

import { MOBILE_MOCKUPS } from '../../components/tour/tour-mockups.ts'
import { getChaptersForRole, getGroupsForRole } from './content.ts'

test('admins get the full 10-chapter track', () => {
  const chapters = getChaptersForRole('admin')
  assert.equal(chapters.length, 10)
  assert.deepEqual(
    chapters.map((chapter) => chapter.id),
    [
      'roles',
      'permissions',
      'appointment',
      'patients',
      'billing',
      'invite',
      'external',
      'types',
      'packages',
      'pending',
    ],
  )
})

test('staff only see the three shared chapters', () => {
  const chapters = getChaptersForRole('staff')
  assert.deepEqual(
    chapters.map((chapter) => chapter.id),
    ['roles', 'appointment', 'patients'],
  )
  // Admin-only chapters must never leak into the staff track.
  for (const adminOnly of ['permissions', 'billing', 'invite', 'external', 'types', 'packages', 'pending']) {
    assert.ok(!chapters.some((chapter) => chapter.id === adminOnly))
  }
})

test('staff chapters use the staff-specific intro and steps when provided', () => {
  const staffRoles = getChaptersForRole('staff').find((chapter) => chapter.id === 'roles')
  const adminRoles = getChaptersForRole('admin').find((chapter) => chapter.id === 'roles')
  assert.ok(staffRoles && adminRoles)
  assert.match(staffRoles.intro, /You are a Staff member/)
  assert.notEqual(staffRoles.intro, adminRoles.intro)
  // The roles chapter has 3 steps for each role, but the copy differs.
  assert.equal(staffRoles.steps[0].title, 'You are Staff')
  assert.equal(adminRoles.steps[0].title, 'Two kinds of user')
})

test('a chapter without a staff variant falls back to the shared copy', () => {
  const staffAppointment = getChaptersForRole('staff').find((chapter) => chapter.id === 'appointment')
  assert.ok(staffAppointment)
  // appointment has stepsStaff (2 steps) but shares its title.
  assert.equal(staffAppointment.steps.length, 2)
  assert.equal(staffAppointment.title, 'Book an appointment & assign it')
})

test('every step carries a title, body and hotspot position', () => {
  for (const role of ['admin', 'staff'] as const) {
    for (const chapter of getChaptersForRole(role)) {
      assert.ok(chapter.steps.length > 0, `${chapter.id} has steps`)
      for (const step of chapter.steps) {
        assert.ok(step.title.length > 0)
        assert.ok(step.body.length > 0)
        assert.equal(typeof step.x, 'number')
        assert.equal(typeof step.y, 'number')
      }
    }
  }
})

test('every role-accessible chapter has a mobile mockup', () => {
  for (const role of ['admin', 'staff'] as const) {
    for (const chapter of getChaptersForRole(role)) {
      assert.ok(MOBILE_MOCKUPS[chapter.id]?.trim(), `${chapter.id} needs a mobile mockup`)
    }
  }
})

test('formerly desktop-only chapters have dedicated mobile mockups', () => {
  for (const chapterId of ['roles', 'permissions', 'billing'] as const) {
    assert.ok(MOBILE_MOCKUPS[chapterId]?.trim(), `${chapterId} needs a mobile mockup`)
  }
})

test('roles mobile mockup does not show billing in the shared phone navigation', () => {
  assert.match(MOBILE_MOCKUPS.roles, /text-decoration:line-through">Billing/)
  assert.equal(MOBILE_MOCKUPS.roles.match(/>Billing</g)?.length, 2)
})

test('groups are ordered and de-duplicated per role', () => {
  assert.deepEqual(getGroupsForRole('admin'), ['Get started', 'Daily work', 'Admin setup'])
  assert.deepEqual(getGroupsForRole('staff'), ['Get started', 'Daily work'])
})
