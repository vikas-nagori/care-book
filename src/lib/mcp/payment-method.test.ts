import assert from 'node:assert/strict'
import test from 'node:test'

import { PAYMENT_METHODS, normalizePaymentMethod, paymentMethodError } from './payment-method.ts'

test('the accepted set matches what the billing RPCs check against', () => {
  // record_payment_v2, record_billing_entry_v2 and record_refund all compare against this exact
  // lowercase list and reject anything else with "Choose a valid payment method."
  assert.deepEqual([...PAYMENT_METHODS], ['cash', 'upi', 'card', 'bank_transfer'])
})

test('exact values pass through', () => {
  for (const method of PAYMENT_METHODS) assert.equal(normalizePaymentMethod(method), method)
})

test('casing is normalized', () => {
  // The reported failure: "UPI" was refused for not being "upi".
  assert.equal(normalizePaymentMethod('UPI'), 'upi')
  assert.equal(normalizePaymentMethod('Cash'), 'cash')
  assert.equal(normalizePaymentMethod('  Card  '), 'card')
})

test('spacing and hyphens map onto the underscored value', () => {
  assert.equal(normalizePaymentMethod('bank transfer'), 'bank_transfer')
  assert.equal(normalizePaymentMethod('Bank-Transfer'), 'bank_transfer')
})

test('common real-world spellings map to the right method', () => {
  assert.equal(normalizePaymentMethod('Google Pay'), 'upi')
  assert.equal(normalizePaymentMethod('PhonePe'), 'upi')
  assert.equal(normalizePaymentMethod('NEFT'), 'bank_transfer')
  assert.equal(normalizePaymentMethod('cheque'), 'bank_transfer')
  assert.equal(normalizePaymentMethod('credit card'), 'card')
})

test('an unmappable method is rejected rather than guessed', () => {
  // A payment filed under the wrong method is a quietly wrong financial record.
  assert.equal(normalizePaymentMethod('barter'), null)
  assert.equal(normalizePaymentMethod(''), null)
  assert.equal(normalizePaymentMethod(null), null)
  assert.equal(normalizePaymentMethod(42), null)
})

test('the error names the accepted values so the caller can correct it', () => {
  const message = paymentMethodError('payment_method')
  for (const method of PAYMENT_METHODS) assert.ok(message.includes(method), `missing ${method}`)
})
