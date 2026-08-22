import assert from 'node:assert/strict'
import test from 'node:test'

import { validateBillingEntry, validateReasonedMutation, validateRecordPayment } from './mutations.ts'

test('a standalone payment is always ordinary-scoped with no package', () => {
  const result = validateRecordPayment({ patientId: 'p1', amount: 500, paymentMethod: 'cash', date: '2026-08-15', notes: 'session fee' })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.rpc, 'record_payment_v2')
  assert.equal(result.params.p_funding_scope, 'ordinary')
  assert.equal(result.params.p_package_id, null)
  assert.equal(result.params.p_amount, 500)
})

test('a non-positive payment amount is refused', () => {
  for (const amount of [0, -1, Number.NaN]) {
    const result = validateRecordPayment({ patientId: 'p1', amount, paymentMethod: 'cash', date: '2026-08-15', notes: null })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.errorCode, 'PAYMENT_INVALID_AMOUNT')
  }
})

test('a package must be paid in full', () => {
  const base = { patientId: 'p1', mode: 'package_with_payment' as const, packageName: '10-session physio', packageTotalSessions: 10, packagePerSessionAmount: 500, appointmentTypeId: 'type-1', packageStartsOn: '2026-08-15', paymentMethod: 'cash', paymentDate: '2026-08-15', paymentNotes: 'package receipt' }
  const partial = validateBillingEntry({ ...base, paymentAmount: 3000 })
  assert.equal(partial.ok, false)
  if (!partial.ok) assert.equal(partial.errorCode, 'PACKAGE_PARTIAL_PAYMENT')
  const full = validateBillingEntry({ ...base, paymentAmount: 5000 })
  assert.equal(full.ok, true)
  if (full.ok) assert.equal(full.summary.packageTotal, 5000)
})

test('reasoned mutations require a non-empty reason', () => {
  const blank = validateReasonedMutation('void_payment', { entityId: 'pay-1', reason: '   ' })
  assert.equal(blank.ok, false)
  const ok = validateReasonedMutation('void_payment', { entityId: 'pay-1', reason: 'Duplicate entry' })
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.rpc, 'void_payment')
    assert.equal(ok.params.p_reason, 'Duplicate entry')
  }
})

test('a refund requires a positive amount, a method and a date', () => {
  const result = validateReasonedMutation('record_refund', { entityId: 'pay-1', reason: 'Overcharged', amount: 500, refundMethod: '', refundDate: '2026-08-15' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.errorCode, 'REFUND_METHOD_REQUIRED')
})
