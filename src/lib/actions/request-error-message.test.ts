import assert from 'node:assert/strict'
import test from 'node:test'

import { NETWORK_ERROR_MESSAGE, isNetworkError, requestErrorMessage } from './request-error-message.ts'

// Shapes supabase-js really returns when the connection drops (it catches the fetch failure and
// hands it back as `error` rather than throwing): PostgREST uses status 0 and a "<Name>: <msg>"
// message; Auth uses AuthRetryableFetchError.
const POSTGREST_OFFLINE = { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' , status: 0 }
const AUTH_OFFLINE = Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 })
const SAFARI_OFFLINE = new TypeError('Load failed')

test('recognises a dropped connection in every shape supabase-js and browsers produce', () => {
  for (const error of [POSTGREST_OFFLINE, AUTH_OFFLINE, SAFARI_OFFLINE, new TypeError('NetworkError when attempting to fetch resource.')]) {
    assert.equal(isNetworkError(error), true, JSON.stringify(error))
    assert.equal(requestErrorMessage(error), NETWORK_ERROR_MESSAGE)
  }
})

test('passes a real server message through unchanged', () => {
  const rls = { message: 'new row violates row-level security policy', code: '42501' }
  assert.equal(isNetworkError(rls), false)
  assert.equal(requestErrorMessage(rls), rls.message)
})

test('falls back when there is no message to show', () => {
  assert.equal(requestErrorMessage(null, 'Unable to save the plan.'), 'Unable to save the plan.')
  assert.equal(requestErrorMessage({ message: '' }, 'Unable to save the plan.'), 'Unable to save the plan.')
})
