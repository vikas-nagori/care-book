import assert from 'node:assert/strict'
import test from 'node:test'

import {
  INVITE_PASSWORD_POLICY_MESSAGE,
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
    password: 'Correct-Horse-1',
    passwordConfirmation: 'Correct-Horse-2',
  })

  assert.deepEqual(result, {
    success: false,
    errorCode: 'INVITE_PASSWORD_MISMATCH',
    message: 'Passwords do not match.',
  })
})

// Invite completion is how every staff and admin account in the system gets its password,
// and the only other gate is the Supabase project's `minimum_password_length`. Enforce the
// policy in app code so it holds regardless of project config drift.
test('validateInviteCompletionInput rejects passwords under the minimum length', () => {
  const result = validateInviteCompletionInput({
    password: 'Short-1a',
    passwordConfirmation: 'Short-1a',
  })

  assert.deepEqual(result, {
    success: false,
    errorCode: 'INVITE_PASSWORD_TOO_WEAK',
    message: INVITE_PASSWORD_POLICY_MESSAGE,
  })
})

test('validateInviteCompletionInput rejects passwords missing a character class', () => {
  for (const password of ['alllowercaseletters', 'ALLUPPERCASELETTERS', 'NoDigitsInHereAtAll', '123456789012345678']) {
    assert.deepEqual(
      validateInviteCompletionInput({ password, passwordConfirmation: password }),
      {
        success: false,
        errorCode: 'INVITE_PASSWORD_TOO_WEAK',
        message: INVITE_PASSWORD_POLICY_MESSAGE,
      },
      `expected ${password} to be rejected`
    )
  }
})

test('validateInviteCompletionInput reports the weak password before the mismatch', () => {
  // The strength error belongs on the password field, so it has to win over the
  // confirmation mismatch when both are true.
  const result = validateInviteCompletionInput({
    password: 'weak',
    passwordConfirmation: 'different',
  })

  assert.equal(result.success, false)
  assert.equal(result.success === false && result.errorCode, 'INVITE_PASSWORD_TOO_WEAK')
})

test('getInviteCompletionFieldErrorTarget maps the weak password error to its field', () => {
  assert.equal(getInviteCompletionFieldErrorTarget('INVITE_PASSWORD_TOO_WEAK'), 'password')
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

test('validateInviteCompletionInput accepts a matching password that meets the policy', () => {
  const result = validateInviteCompletionInput({
    password: 'Correct-Horse-1',
    passwordConfirmation: 'Correct-Horse-1',
  })

  assert.deepEqual(result, {
    success: true,
    values: {
      password: 'Correct-Horse-1',
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
