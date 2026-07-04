import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldHideAppChrome } from './app-chrome.ts'

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
