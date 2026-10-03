import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthSessionMissingError, AuthRetryableFetchError, AuthApiError } from '@supabase/supabase-js'
import { shouldLogAuthError } from './auth-error-classification.ts'

test('expected absence is quiet while token, network and unexpected failures remain observable', () => {
  for (const error of [null, undefined, new AuthSessionMissingError()]) {
    assert.equal(shouldLogAuthError(error), false)
  }
  for (const error of [
    new AuthRetryableFetchError('Network unavailable', 503),
    new AuthApiError('Invalid token', 401, 'bad_jwt'),
    new Error('Auth session missing!'),
  ]) {
    assert.equal(shouldLogAuthError(error), true)
  }
})
