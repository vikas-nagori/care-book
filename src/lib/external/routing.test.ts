import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveExternalStaffRoute, resolveMiddlewareRole } from './routing.ts'

test('external staff land in their workspace from login or a clinic page', () => {
  for (const path of ['/login', '/', '/patients/patient-id', '/schedule/booking-id', '/settings', '/billing', '/platform']) {
    assert.equal(resolveExternalStaffRoute('external_staff', path, 'GET'), '/external')
  }
})

test('external staff can reach their workspace and the explicit authentication flows', () => {
  for (const path of ['/external', '/external/patients', '/external/account', '/auth/callback', '/auth/complete-invite', '/auth/change-password', '/auth/update-password']) {
    assert.equal(resolveExternalStaffRoute('external_staff', path, 'GET'), null)
  }
  assert.equal(resolveExternalStaffRoute('external_staff', '/external', 'POST'), null)
  assert.equal(resolveExternalStaffRoute('external_staff', '/external/patients', 'POST'), null)
  // A look-alike prefix is not the workspace.
  assert.equal(resolveExternalStaffRoute('external_staff', '/externalx', 'GET'), '/external')
  assert.equal(resolveExternalStaffRoute('external_staff', '/externalx', 'POST'), 'forbidden')
})

test('external staff cannot invoke a clinic API, internal server action or unknown auth route', () => {
  assert.equal(resolveExternalStaffRoute('external_staff', '/api/appointments/bookings', 'GET'), 'forbidden')
  assert.equal(resolveExternalStaffRoute('external_staff', '/schedule', 'POST'), 'forbidden')
  assert.equal(resolveExternalStaffRoute('external_staff', '/oauth/authorize', 'POST'), 'forbidden')
  assert.equal(resolveExternalStaffRoute('external_staff', '/auth/new-clinic-endpoint', 'POST'), 'forbidden')
})

test('internal roles keep existing routing decisions', () => {
  assert.equal(resolveExternalStaffRoute('staff', '/schedule', 'POST'), null)
  assert.equal(resolveExternalStaffRoute('admin', '/settings', 'GET'), null)
})

test('external staff may report sanitized client telemetry but no other API', () => {
  assert.equal(resolveExternalStaffRoute('external_staff', '/api/telemetry', 'POST'), null)
  assert.equal(resolveExternalStaffRoute('external_staff', '/api/telemetry', 'GET'), 'forbidden')
  assert.equal(resolveExternalStaffRoute('external_staff', '/api/telemetry/other', 'POST'), 'forbidden')
  assert.equal(resolveExternalStaffRoute('external_staff', '/api/version', 'GET'), null)
  assert.equal(resolveExternalStaffRoute('external_staff', '/api/version', 'POST'), 'forbidden')
})

test('a readable role is used as-is', () => {
  for (const role of ['admin', 'staff', 'external_staff'] as const) {
    assert.equal(resolveMiddlewareRole({ role, lookupFailed: false, isSuperadmin: false, path: '/' }), role)
  }
})

test('no readable profile (blocked account or inactive clinic) keeps the closed workspace routes', () => {
  assert.equal(resolveMiddlewareRole({ role: null, lookupFailed: false, isSuperadmin: false, path: '/' }), 'external_staff')
})

test('a failed profile lookup is reported as unavailable instead of treating the user as external', () => {
  assert.equal(resolveMiddlewareRole({ role: null, lookupFailed: true, isSuperadmin: false, path: '/schedule' }), 'unavailable')
  assert.equal(resolveMiddlewareRole({ role: null, lookupFailed: true, isSuperadmin: false, path: '/external' }), 'unavailable')
})

test('superadmins and the explicit auth flows do not depend on the profile lookup', () => {
  assert.equal(resolveMiddlewareRole({ role: null, lookupFailed: true, isSuperadmin: true, path: '/platform' }), null)
  assert.equal(resolveMiddlewareRole({ role: null, lookupFailed: false, isSuperadmin: true, path: '/platform' }), null)
  assert.equal(resolveMiddlewareRole({ role: null, lookupFailed: false, isSuperadmin: false, path: '/auth/callback' }), null)
})
