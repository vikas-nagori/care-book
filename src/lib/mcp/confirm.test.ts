import assert from 'node:assert/strict'
import test from 'node:test'

import { dryRun, isConfirmed, requireIdempotencyKey } from './confirm.ts'

test('billing writes default to an uncommitted preview', () => {
  assert.equal(isConfirmed({}), false)
  assert.deepEqual(dryRun('record_payment', { amount: 500 }), {
    dry_run: true,
    action: 'record_payment',
    preview: { amount: 500 },
  })
})

test('confirmation requires the literal boolean true', () => {
  assert.equal(isConfirmed({ confirm: true }), true)
  assert.equal(isConfirmed({ confirm: 'true' }), false)
})

test('idempotency keys are required and trimmed', () => {
  assert.equal(requireIdempotencyKey({ idempotency_key: ' key-1 ' }), 'key-1')
  assert.throws(() => requireIdempotencyKey({}), /idempotency_key/)
})
