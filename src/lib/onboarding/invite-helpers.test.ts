import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildInviteRedirectUrl,
  getInviteCollisionResult,
  getInviteCompletionFieldErrorTarget,
  normalizeEmail,
  normalizeSiteOrigin,
  validateInviteInput,
  validateInviteCompletionInput,
} from './invite-helpers.ts'

test('normalizeEmail trims whitespace and lowercases addresses', () => {
  assert.equal(normalizeEmail(' Staff.Member@Example.com '), 'staff.member@example.com')
})

test('validateInviteInput normalizes a valid email invite payload', () => {
  const result = validateInviteInput({
    email: ' Staff.Member@Example.com ',
    role: 'staff',
    fullName: '  Asha Patel  ',
    mobileNumber: ' 9876543210 ',
  })

  assert.deepEqual(result, {
    success: true,
    values: {
      email: 'staff.member@example.com',
      role: 'staff',
      fullName: 'Asha Patel',
      mobileNumber: '9876543210',
    },
  })
})

test('validateInviteInput rejects an invalid email address', () => {
  const result = validateInviteInput({
    email: 'invalid-email',
    role: 'admin',
    fullName: 'Asha Patel',
    mobileNumber: '9876543210',
  })

  assert.deepEqual(result, {
    success: false,
    errorCode: 'INVITE_INVALID_EMAIL',
    message: 'Enter a valid email address.',
  })
})

test('validateInviteInput requires a name', () => {
  const result = validateInviteInput({
    email: 'staff@example.com',
    role: 'staff',
    fullName: '   ',
    mobileNumber: '9876543210',
  })

  assert.deepEqual(result, {
    success: false,
    errorCode: 'INVITE_MISSING_NAME',
    message: 'Enter the user name.',
  })
})

test('validateInviteInput requires a mobile number after a valid name', () => {
  const result = validateInviteInput({
    email: 'staff@example.com',
    role: 'staff',
    fullName: 'Asha Patel',
    mobileNumber: '  ',
  })

  assert.deepEqual(result, {
    success: false,
    errorCode: 'INVITE_MISSING_MOBILE',
    message: 'Enter the mobile number.',
  })
})

test('validateInviteCompletionInput rejects mismatched passwords', () => {
  const result = validateInviteCompletionInput({
    password: 'password-123',
    passwordConfirmation: 'password-456',
  })

  assert.deepEqual(result, {
    success: false,
    errorCode: 'INVITE_PASSWORD_MISMATCH',
    message: 'Passwords do not match.',
  })
})

test('validateInviteCompletionInput requires a password', () => {
  const result = validateInviteCompletionInput({
    password: '',
    passwordConfirmation: '',
  })

  assert.deepEqual(result, {
    success: false,
    errorCode: 'INVITE_MISSING_PASSWORD',
    message: 'Enter a password.',
  })
})

test('validateInviteCompletionInput accepts a matching password', () => {
  const result = validateInviteCompletionInput({
    password: 'password-123',
    passwordConfirmation: 'password-123',
  })

  assert.deepEqual(result, {
    success: true,
    values: {
      password: 'password-123',
    },
  })
})

test('getInviteCompletionFieldErrorTarget maps mismatch errors to confirm password', () => {
  assert.equal(
    getInviteCompletionFieldErrorTarget('INVITE_PASSWORD_MISMATCH'),
    'passwordConfirmation'
  )
})

test('getInviteCompletionFieldErrorTarget maps the missing password error to its field', () => {
  assert.equal(getInviteCompletionFieldErrorTarget('INVITE_MISSING_PASSWORD'), 'password')
})

test('getInviteCompletionFieldErrorTarget returns null for non-field invite errors', () => {
  assert.equal(getInviteCompletionFieldErrorTarget('INVITE_NOT_FOUND'), null)
})

test('normalizeSiteOrigin accepts configured https origins and removes trailing slashes', () => {
  assert.equal(normalizeSiteOrigin(' https://care-book.example.com/// '), 'https://care-book.example.com')
})

test('normalizeSiteOrigin rejects paths and non-http protocols', () => {
  assert.equal(normalizeSiteOrigin('https://care-book.example.com/settings'), null)
  assert.equal(normalizeSiteOrigin('javascript:alert(1)'), null)
})

test('buildInviteRedirectUrl uses the canonical app origin', () => {
  assert.equal(
    buildInviteRedirectUrl('https://care-book.example.com'),
    'https://care-book.example.com/auth/callback?next=%2Fauth%2Fcomplete-invite'
  )
})

test('getInviteCollisionResult permits same-clinic revoked invites to be reused', () => {
  assert.equal(
    getInviteCollisionResult({
      currentClinicId: 'clinic-a',
      existingInvite: { clinic_id: 'clinic-a', status: 'revoked' },
      existingProfile: null,
    }),
    'reuse_revoked_invite'
  )
})

test('getInviteCollisionResult blocks cross-clinic invites without mutating them', () => {
  assert.equal(
    getInviteCollisionResult({
      currentClinicId: 'clinic-a',
      existingInvite: { clinic_id: 'clinic-b', status: 'revoked' },
      existingProfile: null,
    }),
    'conflict'
  )
})
