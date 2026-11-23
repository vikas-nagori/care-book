import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTempPasswordShareText, isShareCancelled } from './temp-password-share.ts'

const CREDENTIALS = { mobileNumber: null, email: 'asha@example.com', tempPassword: 'Abcdef23456789' }

test('share text carries the sign-in link, email and temporary password', () => {
  assert.equal(
    buildTempPasswordShareText(CREDENTIALS, 'https://care-book.example.com/'),
    [
      'Your Care-Book login',
      'Sign in: https://care-book.example.com/login',
      'Email: asha@example.com',
      'Temporary password: Abcdef23456789',
      'You’ll set your own password after signing in.',
    ].join('\n')
  )
})

test('share text names the mobile number as the login when there is one', () => {
  const text = buildTempPasswordShareText({ ...CREDENTIALS, mobileNumber: '9511219264' }, 'https://care-book.co')
  assert.match(text, /^Mobile number: 95112 19264$/m)
  assert.doesNotMatch(text, /Email:/)
})

test('a cancelled share sheet is not treated as a failure', () => {
  const abort = new Error('Share canceled')
  abort.name = 'AbortError'
  assert.equal(isShareCancelled(abort), true)
  assert.equal(isShareCancelled(new Error('NotAllowedError')), false)
  assert.equal(isShareCancelled('nope'), false)
})
