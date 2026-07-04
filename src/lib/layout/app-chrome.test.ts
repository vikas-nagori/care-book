import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldHideAppChrome } from './app-chrome.ts'

test('shouldHideAppChrome hides chrome on login and invite completion routes', () => {
  assert.equal(shouldHideAppChrome('/login'), true)
  assert.equal(shouldHideAppChrome('/auth/complete-invite'), true)
})

test('shouldHideAppChrome keeps chrome visible on standard app pages', () => {
  assert.equal(shouldHideAppChrome('/'), false)
  assert.equal(shouldHideAppChrome('/settings'), false)
})
