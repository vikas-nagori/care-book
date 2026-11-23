import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getSignInErrorMessage, resolveSignInIdentifier } from './sign-in-identifier.ts'

describe('resolveSignInIdentifier', () => {
  it('passes the 10 digits to Auth unchanged, spaces removed', () => {
    assert.deepEqual(resolveSignInIdentifier('mobile', '95112 19264'), { ok: true, credentials: { phone: '9511219264' } })
    assert.deepEqual(resolveSignInIdentifier('mobile', '9511219264'), { ok: true, credentials: { phone: '9511219264' } })
  })

  it('refuses a mobile number it cannot read, before calling Auth', () => {
    assert.deepEqual(resolveSignInIdentifier('mobile', '12345'), { ok: false, message: 'Enter your 10-digit mobile number, without +91 or 0.' })
    assert.equal(resolveSignInIdentifier('mobile', '+91 95112 19264').ok, false)
    assert.equal(resolveSignInIdentifier('mobile', 'me@example.com').ok, false)
  })

  it('passes email through lower-cased and trimmed', () => {
    assert.deepEqual(resolveSignInIdentifier('email', ' Me@Example.com '), { ok: true, credentials: { email: 'me@example.com' } })
    assert.equal(resolveSignInIdentifier('email', '   ').ok, false)
  })
})

describe('getSignInErrorMessage', () => {
  it('never says which half of the credentials was wrong', () => {
    const invalid = { code: 'invalid_credentials', message: 'Invalid login credentials' }
    assert.equal(getSignInErrorMessage('mobile', invalid), 'Mobile number or password is incorrect.')
    assert.equal(getSignInErrorMessage('email', invalid), 'Email or password is incorrect.')
  })

  it('points people at email while phone sign-in is off', () => {
    assert.match(getSignInErrorMessage('mobile', { code: 'phone_provider_disabled', message: 'x' }), /email instead/)
  })

  it('falls back to the Auth message for anything else', () => {
    assert.equal(getSignInErrorMessage('mobile', { code: 'over_request_rate_limit', message: 'Too many requests' }), 'Too many requests')
  })
})
