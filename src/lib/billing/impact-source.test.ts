import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mapSupabaseBillingSource } from './impact-source.ts'

test('maps legacy migration-029 rows into the version-neutral impact model', () => {
  const mapped = mapSupabaseBillingSource({
    clinics: [{ id: 'clinic', name: 'Amruta' }],
    patients: [{ id: 'patient', clinic_id: 'clinic', name: 'Smita' }],
    appointment_types: [{ id: 'type', clinic_id: 'clinic', name: 'Clinic', is_default: true, is_shared: true, sort_order: 0 }],
    appointments: [{
      id: 'appointment', clinic_id: 'clinic', patient_id: 'patient', appointment_type_id: 'type',
      date: '2026-08-15', time: '10:00:00', status: 'scheduled', fee: '650.00',
      payment_status: 'prepaid', created_at: '2026-08-01T00:00:00Z',
    }],
    packages: [{
      id: 'package', clinic_id: 'clinic', patient_id: 'patient', name: 'Five', total_sessions: 5,
      used_sessions: 1, total_amount: '3250.00', per_session_amount: '650.00', paid_amount: '3250.00',
      status: 'active', created_at: '2026-07-01T00:00:00Z',
    }],
    payments: [{
      id: 'payment', clinic_id: 'clinic', patient_id: 'patient', package_id: 'package',
      amount: '3250.00', payment_method: 'upi', date: '2026-07-01', created_at: '2026-07-01T00:00:00Z',
    }],
    appointment_payments: [{ payment_id: 'payment', appointment_id: 'appointment', amount_applied: '650.00', created_at: '2026-07-01T00:00:00Z' }],
    package_session_allocations: [{ package_id: 'package', appointment_id: 'appointment', created_at: '2026-07-01T00:00:00Z' }],
  })

  assert.equal(mapped.appointments[0]?.fee, 650)
  assert.equal(mapped.packages[0]?.appointmentTypeId, null)
  assert.equal(mapped.packages[0]?.startsOn, null)
  assert.equal(mapped.payments[0]?.fundingScope, undefined)
  assert.equal(mapped.appointmentPayments[0]?.amountApplied, 650)
  assert.deepEqual(mapped.refunds, [])
})

test('maps v2 receipt lifecycle and refund audit rows when present', () => {
  const mapped = mapSupabaseBillingSource({
    clinics: [], patients: [], appointment_types: [], appointments: [], packages: [], appointment_payments: [], package_session_allocations: [],
    payments: [{
      id: 'payment', clinic_id: 'clinic', patient_id: 'patient', package_id: null,
      amount: 600, payment_method: 'upi', date: '2026-07-15', created_at: '2026-07-15T00:00:00Z',
      funding_scope: 'ordinary', status: 'voided',
    }],
    refunds: [{
      id: 'refund', clinic_id: 'clinic', patient_id: 'patient', payment_id: 'payment', amount: '100.00',
      refund_method: 'upi', refund_date: '2026-07-30', reason: 'correction', created_at: '2026-07-30T00:00:00Z',
    }],
    refund_reversals: [{ id: 'reversal', refund_id: 'refund', created_at: '2026-07-31T00:00:00Z' }],
  })

  assert.equal(mapped.payments[0]?.fundingScope, 'ordinary')
  assert.equal(mapped.payments[0]?.status, 'voided')
  assert.equal(mapped.refunds?.[0]?.amount, 100)
  assert.equal(mapped.refundReversals?.[0]?.refundId, 'refund')
})
