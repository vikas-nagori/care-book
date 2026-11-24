import assert from 'node:assert/strict'
import test from 'node:test'

import { callBillingRpc, validateBillingEntry, validateReasonedMutation, validateRecordPayment } from './mutations.ts'

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

test('a package can be saved without notes', () => {
  const base = { patientId: 'p1', mode: 'package_with_payment' as const, packageName: '5 session package', packageTotalSessions: 5, packagePerSessionAmount: 650, appointmentTypeId: 'type-1', packageStartsOn: '2026-08-15', paymentAmount: 3250, paymentMethod: 'upi', paymentDate: '2026-08-15' }
  for (const paymentNotes of [null, undefined, '', '   ']) {
    const result = validateBillingEntry({ ...base, paymentNotes })
    assert.equal(result.ok, true, `notes ${JSON.stringify(paymentNotes)} should be accepted`)
  }
  const blank = validateBillingEntry({ ...base, paymentNotes: null })
  if (blank.ok) assert.equal(blank.params.p_notes, null)
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

test('a valid request key selects the idempotent overload; anything else is left out (G-14)', () => {
  const key = '6f1c2a4e-8b7d-4c3a-9e2f-1a2b3c4d5e6f'
  const payment = validateRecordPayment({ patientId: 'p1', amount: 500, paymentMethod: 'cash', date: '2026-08-15', notes: null, requestKey: key })
  assert.equal(payment.ok && payment.params.p_request_id, key)
  const entry = validateBillingEntry({ patientId: 'p1', mode: 'package_with_payment', packageName: 'Pack', packageTotalSessions: 2, packagePerSessionAmount: 500, appointmentTypeId: 't1', packageStartsOn: '2026-08-15', paymentAmount: 1000, paymentMethod: 'cash', paymentDate: '2026-08-15', requestKey: key })
  assert.equal(entry.ok && entry.params.p_request_id, key)
  for (const requestKey of [undefined, '', 'not-a-uuid', `${key}'; drop table payments; --`]) {
    const result = validateRecordPayment({ patientId: 'p1', amount: 500, paymentMethod: 'cash', date: '2026-08-15', notes: null, requestKey })
    assert.equal(result.ok && 'p_request_id' in result.params, false, `requestKey ${JSON.stringify(requestKey)}`)
  }
})

test('callBillingRpc retries without p_request_id when the overload is not deployed yet', async () => {
  const calls: Record<string, unknown>[] = []
  const supabase = {
    rpc: async (_name: string, params: Record<string, unknown>) => {
      calls.push(params)
      return 'p_request_id' in params
        ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
        : { data: { success: true, paymentId: 'pay-1' }, error: null }
    },
  } as unknown as Parameters<typeof callBillingRpc>[0]
  const result = await callBillingRpc(supabase, 'record_payment_v2', { p_patient_id: 'p1', p_request_id: 'k' }, {})
  assert.deepEqual(result, { success: true, paymentId: 'pay-1' })
  assert.deepEqual(calls, [{ p_patient_id: 'p1', p_request_id: 'k' }, { p_patient_id: 'p1' }])
})

test('callBillingRpc does not retry other errors', async () => {
  let calls = 0
  const supabase = {
    rpc: async () => { calls++; return { data: null, error: { code: '42501', message: 'nope' } } },
  } as unknown as Parameters<typeof callBillingRpc>[0]
  const result = await callBillingRpc(supabase, 'record_payment_v2', { p_request_id: 'k' }, {})
  assert.equal(result?.success, false)
  assert.equal(calls, 1)
})
