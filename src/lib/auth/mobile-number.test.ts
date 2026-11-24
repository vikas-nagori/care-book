import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  accountContactLabel,
  accountDisplayName,
  formatMobileNumber,
  fromAuthPhone,
  normalizeMobileNumber,
  toAuthPhone,
} from './mobile-number.ts'

describe('normalizeMobileNumber', () => {
  it('accepts the 10 digits, with or without spaces or dashes between them', () => {
    for (const raw of ['9511219264', ' 95112 19264 ', '95112-19264', '951 121 9264']) {
      assert.equal(normalizeMobileNumber(raw), '9511219264', raw)
    }
  })

  it('refuses a country code or a leading 0: the number must be the 10 digits alone', () => {
    for (const raw of ['+919511219264', '919511219264', '+91 95112 19264', '09511219264']) {
      assert.equal(normalizeMobileNumber(raw), null, raw)
    }
  })

  it('rejects anything that is not a 10-digit Indian mobile number', () => {
    for (const raw of ['', '   ', '12345', '5511219264', '95112192645', '0000000000', '(951) 121-9264', '9511219264@example.com', '95112l9264']) {
      assert.equal(normalizeMobileNumber(raw), null, raw)
    }
  })

  it('treats null and undefined as missing', () => {
    assert.equal(normalizeMobileNumber(null), null)
    assert.equal(normalizeMobileNumber(undefined), null)
  })
})

describe('auth phone conversion', () => {
  it('stores and reads the same 10 digits, never a country code', () => {
    assert.equal(toAuthPhone('9511219264'), '9511219264')
    assert.equal(fromAuthPhone('9511219264'), '9511219264')
    assert.equal(fromAuthPhone('919511219264'), null)
    assert.equal(fromAuthPhone(''), null)
    assert.equal(fromAuthPhone(null), null)
  })
})

describe('display', () => {
  it('formats recognised numbers and passes anything else through trimmed', () => {
    assert.equal(formatMobileNumber('9511219264'), '95112 19264')
    assert.equal(formatMobileNumber(' 12345 '), '12345')
    assert.equal(formatMobileNumber(null), '')
  })

  it('names an account by email first, else by mobile number', () => {
    assert.equal(accountContactLabel({ email: 'a@example.com', mobile_number: '9511219264' }), 'a@example.com')
    assert.equal(accountContactLabel({ email: null, mobile_number: '9511219264' }), '95112 19264')
    assert.equal(accountContactLabel({ email: null, mobile_number: null }), 'No contact details')
  })
})

describe('accountDisplayName', () => {
  it('prefers the name, then the email, then the formatted mobile number', () => {
    assert.equal(accountDisplayName({ full_name: ' Asha ', email: 'a@x.test', mobile_number: '9511219264' }), 'Asha')
    assert.equal(accountDisplayName({ full_name: null, email: 'a@x.test', mobile_number: '9511219264' }), 'a@x.test')
    // A pending mobile-only invitee's profile: no name, no email (incident 2026-11-24).
    assert.equal(accountDisplayName({ full_name: null, email: null, mobile_number: '9511219264' }), '95112 19264')
    assert.equal(accountDisplayName({ full_name: null, email: null, mobile_number: null }), 'No contact details')
  })
})
