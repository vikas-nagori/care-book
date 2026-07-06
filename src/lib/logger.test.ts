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
