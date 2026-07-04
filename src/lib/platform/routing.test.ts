import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveSuperadminRedirect } from './routing.ts'

test('superadmin on a clinic route is sent to the platform console', () => {
  assert.equal(
    resolveSuperadminRedirect({ isSuperadmin: true, path: '/patients', isPublicRoute: false }),
    '/platform'
  )
  assert.equal(
    resolveSuperadminRedirect({ isSuperadmin: true, path: '/', isPublicRoute: false }),
    '/platform'
  )
})

test('superadmin already inside the platform console is left alone', () => {
  assert.equal(
    resolveSuperadminRedirect({ isSuperadmin: true, path: '/platform', isPublicRoute: false }),
    null
  )
  assert.equal(
    resolveSuperadminRedirect({ isSuperadmin: true, path: '/platform/clinics', isPublicRoute: false }),
    null
  )
})

test('superadmin on a public/auth route is not redirected', () => {
  assert.equal(
    resolveSuperadminRedirect({ isSuperadmin: true, path: '/auth/complete-invite', isPublicRoute: true }),
    null
  )
})

test('non-superadmin is bounced out of the platform console', () => {
  assert.equal(
    resolveSuperadminRedirect({ isSuperadmin: false, path: '/platform', isPublicRoute: false }),
    '/'
  )
  assert.equal(
    resolveSuperadminRedirect({ isSuperadmin: false, path: '/platform/users', isPublicRoute: false }),
    '/'
  )
})

test('non-superadmin on a clinic route is not redirected', () => {
  assert.equal(
    resolveSuperadminRedirect({ isSuperadmin: false, path: '/schedule', isPublicRoute: false }),
    null
  )
})
