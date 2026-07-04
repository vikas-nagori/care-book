import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getInviteCompletionFieldErrorTarget,
  normalizeEmail,
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
  })

  assert.deepEqual(result, {
    success: true,
    values: {
      email: 'staff.member@example.com',
      role: 'staff',
    },
  })
})

test('validateInviteInput rejects an invalid email address', () => {
  const result = validateInviteInput({
    email: 'invalid-email',
    role: 'admin',
  })

  assert.deepEqual(result, {
    success: false,
    errorCode: 'INVITE_INVALID_EMAIL',
    message: 'Enter a valid email address.',
  })
})

test('validateInviteCompletionInput rejects mismatched passwords', () => {
  const result = validateInviteCompletionInput({
    fullName: 'Asha Patel',
    mobileNumber: '9876543210',
    password: 'password-123',
    passwordConfirmation: 'password-456',
  })

  assert.deepEqual(result, {
    success: false,
    errorCode: 'INVITE_PASSWORD_MISMATCH',
    message: 'Passwords do not match.',
  })
})

test('validateInviteCompletionInput requires name and mobile number', () => {
  const result = validateInviteCompletionInput({
    fullName: '   ',
    mobileNumber: '',
    password: 'password-123',
    passwordConfirmation: 'password-123',
  })

  assert.deepEqual(result, {
    success: false,
    errorCode: 'INVITE_MISSING_NAME',
    message: 'Enter the user name.',
  })
})

test('validateInviteCompletionInput requires a mobile number after a valid name', () => {
  const result = validateInviteCompletionInput({
    fullName: 'Asha Patel',
    mobileNumber: '   ',
    password: 'password-123',
    passwordConfirmation: 'password-123',
  })

  assert.deepEqual(result, {
    success: false,
    errorCode: 'INVITE_MISSING_MOBILE',
    message: 'Enter the mobile number.',
  })
})

test('validateInviteCompletionInput requires a password after user details are present', () => {
  const result = validateInviteCompletionInput({
    fullName: 'Asha Patel',
    mobileNumber: '9876543210',
    password: '',
    passwordConfirmation: '',
  })

  assert.deepEqual(result, {
    success: false,
    errorCode: 'INVITE_MISSING_PASSWORD',
    message: 'Enter a password.',
  })
})

test('validateInviteCompletionInput trims valid values', () => {
  const result = validateInviteCompletionInput({
    fullName: '  Asha Patel  ',
    mobileNumber: ' 9876543210 ',
    password: 'password-123',
    passwordConfirmation: 'password-123',
  })

  assert.deepEqual(result, {
    success: true,
    values: {
      fullName: 'Asha Patel',
      mobileNumber: '9876543210',
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

test('getInviteCompletionFieldErrorTarget maps missing values to their matching fields', () => {
  assert.equal(getInviteCompletionFieldErrorTarget('INVITE_MISSING_NAME'), 'fullName')
  assert.equal(getInviteCompletionFieldErrorTarget('INVITE_MISSING_MOBILE'), 'mobileNumber')
  assert.equal(getInviteCompletionFieldErrorTarget('INVITE_MISSING_PASSWORD'), 'password')
})

test('getInviteCompletionFieldErrorTarget returns null for non-field invite errors', () => {
  assert.equal(getInviteCompletionFieldErrorTarget('INVITE_NOT_FOUND'), null)
})
