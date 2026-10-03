import assert from 'node:assert/strict'
import test from 'node:test'

import { logger, redactLogMeta } from './logger.ts'

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
      clinicName: '[REDACTED]',
    }
  )
})

test('structured errors omit arbitrary diagnostic text and patient names', (t) => {
  const calls: unknown[][] = []
  t.mock.method(console, 'error', (...args: unknown[]) => calls.push(args))
  const circular: Record<string, unknown> = { name: 'Sample Patient', amount: 500, diagnostic: 'clinical free text' }
  circular.self = circular
  logger.error('Dashboard/test', {
    code: '23505', message: 'Duplicate Sample Patient', details: 'private billing detail', hint: 'raw body',
  }, { nested: circular, failure: new Error('Sample Patient diagnosis'), durationMs: 12 })
  assert.equal(calls[0].length, 1)
  const raw = calls[0][0] as string
  const event = JSON.parse(raw)
  assert.equal(event.level, 'error')
  assert.equal(event.context, 'Dashboard/test')
  assert.equal(event.errorCode, '23505')
  assert.equal(event.meta.durationMs, 12)
  assert.ok(!Number.isNaN(Date.parse(event.timestamp)))
  assert.equal(event.meta.nested.amount, '[REDACTED]')
  for (const sensitive of ['Sample Patient', 'clinical free text', 'private billing detail', 'raw body']) {
    assert.equal(raw.includes(sensitive), false)
  }
  assert.equal(event.meta.nested.self, '[Circular]')
})

test('structured info and warnings redact header credentials and survive bigint metadata', (t) => {
  const calls: unknown[][] = []
  t.mock.method(console, 'log', (...args: unknown[]) => calls.push(args))
  t.mock.method(console, 'warn', (...args: unknown[]) => calls.push(args))
  logger.info('cron/test', 'Run completed', { count: BigInt(2) })
  logger.warn('auth/test', 'Authorization: Bearer short-secret', { 'x-api-key': 'short-key' })
  for (const args of calls) {
    assert.equal(args.length, 1)
    assert.doesNotThrow(() => JSON.parse(args[0] as string))
    assert.equal((args[0] as string).includes('short-secret'), false)
    assert.equal((args[0] as string).includes('short-key'), false)
  }
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
