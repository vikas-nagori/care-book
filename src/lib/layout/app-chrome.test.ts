import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAppNavVariant, shouldHideAppChrome } from './app-chrome.ts'

test('shouldHideAppChrome hides chrome on login and auth flow routes', () => {
  assert.equal(shouldHideAppChrome('/login'), true)
  assert.equal(shouldHideAppChrome('/clinic-onboarding'), true)
  assert.equal(shouldHideAppChrome('/auth/complete-invite'), true)
  assert.equal(shouldHideAppChrome('/auth/update-password'), true)
  assert.equal(shouldHideAppChrome('/platform/clinic-requests'), true)
})

test('shouldHideAppChrome keeps chrome visible on standard app pages', () => {
  assert.equal(shouldHideAppChrome('/'), false)
  assert.equal(shouldHideAppChrome('/settings'), false)
})

test('the External Staff workspace hides clinic navigation', () => {
  // External Staff get the shared sidebar / bottom bar with their own destinations.
  assert.equal(shouldHideAppChrome('/external'), false)
  assert.equal(shouldHideAppChrome('/external/patients'), false)
})

test('G-26: a signed-in account with no readable profile (blocked, inactive clinic) gets no navigation', () => {
  assert.equal(resolveAppNavVariant({ role: null, signedIn: true, isSuperadmin: false }), 'none')
})

test('navigation follows the role, and superadmins and signed-out pages keep the clinic default', () => {
  assert.equal(resolveAppNavVariant({ role: 'external_staff', signedIn: true, isSuperadmin: false }), 'external')
  assert.equal(resolveAppNavVariant({ role: 'admin', signedIn: true, isSuperadmin: false }), 'clinic')
  assert.equal(resolveAppNavVariant({ role: 'staff', signedIn: true, isSuperadmin: false }), 'clinic')
  assert.equal(resolveAppNavVariant({ role: null, signedIn: true, isSuperadmin: true }), 'clinic')
  assert.equal(resolveAppNavVariant({ role: null, signedIn: false, isSuperadmin: false }), 'clinic')
})
