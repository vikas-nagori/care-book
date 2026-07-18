import assert from 'node:assert/strict'
import test from 'node:test'

import { getMobileSettingsSections } from './mobile-sections.ts'

const counts = {
  appointmentTypes: 2,
  packageTemplates: 1,
  externalStaff: 3,
  invites: 4,
  activeUsers: 1,
}

test('admin mobile settings sections follow the required order without Session Fees', () => {
  const sections = getMobileSettingsSections('admin', counts)

  assert.deepEqual(
    sections.map(({ key, title }) => ({ key, title })),
    [
      { key: 'account', title: 'Your Account' },
      { key: 'types', title: 'Appointment Types' },
      { key: 'packages', title: 'Package Templates' },
      { key: 'invite', title: 'Invite User' },
      { key: 'staff', title: 'External Staff' },
      { key: 'invites', title: 'Invites' },
      { key: 'users', title: 'Active Users' },
    ],
  )
  assert.equal(sections.some((section) => section.title === 'Session Fees'), false)
})

test('profile-only mobile settings contains only the account section', () => {
  assert.deepEqual(getMobileSettingsSections('profile_only', counts), [
    { key: 'account', title: 'Your Account', subtitle: 'Profile & logout' },
  ])
})

test('count subtitles use the required singular labels', () => {
  const sections = getMobileSettingsSections('admin', {
    appointmentTypes: 1,
    packageTemplates: 1,
    externalStaff: 1,
    invites: 1,
    activeUsers: 1,
  })

  assert.deepEqual(sections.map((section) => section.subtitle), [
    'Profile & logout',
    '1 type',
    '1 template',
    'Add staff or admin',
    '1 person',
    '1 sent',
    '1 user',
  ])
})

test('count subtitles use the required plural labels, including zero', () => {
  const sections = getMobileSettingsSections('admin', {
    appointmentTypes: 0,
    packageTemplates: 2,
    externalStaff: 2,
    invites: 0,
    activeUsers: 2,
  })

  assert.deepEqual(sections.map((section) => section.subtitle), [
    'Profile & logout',
    '0 types',
    '2 templates',
    'Add staff or admin',
    '2 people',
    '0 sent',
    '2 users',
  ])
})
