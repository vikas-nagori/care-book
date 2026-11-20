import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTempPasswordShareText, isShareCancelled } from './temp-password-share.ts'

const CREDENTIALS = { email: 'asha@example.com', tempPassword: 'Abcdef23456789' }

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

test('a cancelled share sheet is not treated as a failure', () => {
  const abort = new Error('Share canceled')
  abort.name = 'AbortError'
  assert.equal(isShareCancelled(abort), true)
  assert.equal(isShareCancelled(new Error('NotAllowedError')), false)
  assert.equal(isShareCancelled('nope'), false)
})
