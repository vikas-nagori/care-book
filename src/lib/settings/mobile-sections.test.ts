import assert from 'node:assert/strict'
import test from 'node:test'

import { getMobileSettingsSections } from './mobile-sections.ts'

const counts = {
  appointmentTypes: 2,
  packageTemplates: 1,
  externalStaff: 3,
  pendingInvites: 4,
  activeUsers: 1,
}

test('admin mobile settings sections include Session Fees after the account summary', () => {
  const sections = getMobileSettingsSections('admin', counts)

  assert.deepEqual(
    sections.map(({ key, title }) => ({ key, title })),
    [
      { key: 'account', title: 'Your Account' },
      { key: 'connected_apps', title: 'Connected Apps' },
      { key: 'fees', title: 'Session Fees' },
      { key: 'types', title: 'Appointment Types' },
      { key: 'packages', title: 'Package Templates' },
      { key: 'invite', title: 'Invite User' },
      { key: 'staff', title: 'Temporary Staff' },
      { key: 'invites', title: 'Invites' },
      { key: 'users', title: 'Active Users' },
    ],
  )
  assert.equal(sections.some((section) => section.title === 'Session Fees'), true)
})

test('profile-only mobile settings contains account and connected apps', () => {
  assert.deepEqual(getMobileSettingsSections('profile_only', counts), [
    { key: 'account', title: 'Your Account', subtitle: 'Profile & logout' },
    { key: 'connected_apps', title: 'Connected Apps', subtitle: '0 apps' },
  ])
})

test('count subtitles use the required singular labels', () => {
  const sections = getMobileSettingsSections('admin', {
    appointmentTypes: 1,
    packageTemplates: 1,
    externalStaff: 1,
    pendingInvites: 1,
    activeUsers: 1,
    connectedApps: 1,
  })

  assert.deepEqual(sections.map((section) => section.subtitle), [
    'Profile & logout',
    '1 app',
    'Clinic & home visits',
    '1 type',
    '1 template',
    'Add a user to Care-Book',
    '1 person',
    '1 pending',
    '1 user',
  ])
})

test('count subtitles use the required plural labels, including zero', () => {
  const sections = getMobileSettingsSections('admin', {
    appointmentTypes: 0,
    packageTemplates: 2,
    externalStaff: 2,
    pendingInvites: 0,
    activeUsers: 2,
    connectedApps: 0,
  })

  assert.deepEqual(sections.map((section) => section.subtitle), [
    'Profile & logout',
    '0 apps',
    'Clinic & home visits',
    '0 types',
    '2 templates',
    'Add a user to Care-Book',
    '2 people',
    '0 pending',
    '2 users',
  ])
})
