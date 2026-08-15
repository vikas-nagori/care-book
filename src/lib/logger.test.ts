import assert from 'node:assert/strict'
import test from 'node:test'

import { redactLogMeta } from './logger.ts'

test('redactLogMeta recursively removes sensitive patient and credential fields', () => {
  const redacted = redactLogMeta({
    email: 'patient@example.com',
    phone: '9876543210',
    nested: {
      address: 'Bandra',
      notes: 'Pain increased after exercise',
      token: 'secret-token',
      safeCount: 2,
    },
    rows: [
      {
        medical_history: 'Diabetes',
        password: 'pass',
        status: 'pending',
      },
    ],
  })

  assert.deepEqual(redacted, {
    email: '[REDACTED]',
    phone: '[REDACTED]',
    nested: {
      address: '[REDACTED]',
      notes: '[REDACTED]',
      token: '[REDACTED]',
      safeCount: 2,
    },
    rows: [
      {
        medical_history: '[REDACTED]',
        password: '[REDACTED]',
        status: 'pending',
      },
    ],
  })
})

test('redactLogMeta redacts camelCase keys, not just snake_case ones', () => {
  // Every input type in this codebase is camelCase, so a snake_case-only key pattern
  // let the guard be bypassed by naming convention alone.
  assert.deepEqual(
    redactLogMeta({
      password: 'Hunter2clinic!',
      passwordConfirmation: 'Hunter2clinic!',
      ownerMobileNumber: '9876543210',
      mobileNumber: '9876543210',
      clinicAddress: '12 MG Road, Pune',
      fullName: 'Asha Rao',
      sessionNotes: 'Pain increased after exercise',
      medicalHistory: 'Diabetes',
      accessToken: 'abc',
      apiKey: 'abc',
      role: 'staff',
      clinicName: 'Sunrise Physio',
    }),
    {
      password: '[REDACTED]',
      passwordConfirmation: '[REDACTED]',
      ownerMobileNumber: '[REDACTED]',
      mobileNumber: '[REDACTED]',
      clinicAddress: '[REDACTED]',
      fullName: '[REDACTED]',
      sessionNotes: '[REDACTED]',
      medicalHistory: '[REDACTED]',
      accessToken: '[REDACTED]',
      apiKey: '[REDACTED]',
      role: 'staff',
      clinicName: 'Sunrise Physio',
    }
  )
})

test('redactLogMeta redacts kebab-case and header-style keys', () => {
  assert.deepEqual(
    redactLogMeta({
      'x-api-key': 'abc',
      'Content-Type': 'application/json',
      'Set-Cookie': 'sb-token=1',
    }),
    {
      'x-api-key': '[REDACTED]',
      'Content-Type': 'application/json',
      'Set-Cookie': '[REDACTED]',
    }
  )
})

test('redactLogMeta keeps non-sensitive identifiers readable for debugging', () => {
  assert.deepEqual(
    redactLogMeta({
      userId: 'u-1',
      inviteId: 'i-1',
      clinicId: 'c-1',
      patientId: 'p-1',
      errorCode: 'INVITE_NOT_FOUND',
      statusCode: 500,
    }),
    {
      userId: 'u-1',
      inviteId: 'i-1',
      clinicId: 'c-1',
      patientId: 'p-1',
      errorCode: 'INVITE_NOT_FOUND',
      statusCode: 500,
    }
  )
})

test('redactLogMeta redacts raw input and values objects wholesale', () => {
  assert.deepEqual(
    redactLogMeta({
      input: { email: 'patient@example.com' },
      values: { phone: '9876543210' },
      errorCode: 'INVALID',
    }),
    {
      input: '[REDACTED]',
      values: '[REDACTED]',
      errorCode: 'INVALID',
    }
  )
})
