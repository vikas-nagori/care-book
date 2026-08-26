import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  FORCED_PASSWORD_CHANGE_PATH,
  mustChangePassword,
  needsForcedPasswordChange,
} from './forced-password-change.ts'

test('the flag is only honoured when it is literally true', () => {
  assert.equal(mustChangePassword({ must_change_password: true }), true)
  assert.equal(mustChangePassword({ must_change_password: false }), false)
  assert.equal(mustChangePassword({ must_change_password: 'true' }), false)
  assert.equal(mustChangePassword({}), false)
  assert.equal(mustChangePassword(undefined), false)
  assert.equal(mustChangePassword(null), false)
})

test('a flagged user is redirected from app routes', () => {
  assert.equal(needsForcedPasswordChange({ must_change_password: true }, '/'), true)
  assert.equal(needsForcedPasswordChange({ must_change_password: true }, '/patients'), true)
  assert.equal(needsForcedPasswordChange({ must_change_password: true }, '/settings'), true)
})

test('auth routes are exempt so the change page and callback stay reachable', () => {
  assert.equal(
    needsForcedPasswordChange({ must_change_password: true }, FORCED_PASSWORD_CHANGE_PATH),
    false
  )
  assert.equal(needsForcedPasswordChange({ must_change_password: true }, '/auth/callback'), false)
  assert.equal(
    needsForcedPasswordChange({ must_change_password: true }, '/auth/complete-invite'),
    false
  )
})

test('unflagged users are never redirected', () => {
  assert.equal(needsForcedPasswordChange({}, '/'), false)
  assert.equal(needsForcedPasswordChange(undefined, '/patients'), false)
})
