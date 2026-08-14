import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LIVE_DB_FINGERPRINT_VERSION, buildBillingSourceRowCounts, buildLiveDatabaseFingerprint } from './live-db-fingerprint.ts'

function fixture() {
  return {
    clinics: [{ id: 'clinic-b', name: 'Other' }, { id: 'clinic-a', name: 'Amruta' }],
    patients: [{ id: 'patient-a', clinic_id: 'clinic-a', name: 'Smita' }],
    appointment_types: [{
      id: 'type-a', clinic_id: 'clinic-a', name: 'Clinic', session_rate: '650.00',
      is_shared: true, is_default: true, sort_order: 0,
    }],
    global_settings: [
      { id: 10, clinic_id: 'clinic-b', home_visit_fee: '900.00', clinic_fee: '700.00' },
      { id: 2, clinic_id: 'clinic-a', home_visit_fee: '800.00', clinic_fee: '650.00' },
    ],
    package_templates: [{
      id: 'template-a', clinic_id: 'clinic-a', name: 'Five', min_sessions: 5,
      per_session_amount: '650.00', created_at: '2026-08-01T00:00:00+00:00',
    }],
    appointments: [{
      id: 'appointment-a', clinic_id: 'clinic-a', patient_id: 'patient-a', appointment_type_id: 'type-a',
      date: '2026-08-15', time: '10:00:00', status: 'scheduled', fee: '650.00',
      payment_status: 'unpaid', created_at: '2026-08-01T00:00:00+00:00',
    }],
    packages: [{
      id: 'package-a', clinic_id: 'clinic-a', patient_id: 'patient-a', name: 'Five', total_sessions: 5,
      used_sessions: 1, total_amount: '3250.00', per_session_amount: '650.00', paid_amount: '3250.00',
      payment_timing: 'prepaid', status: 'active', created_at: '2026-08-01T00:00:00+00:00',
    }],
    payments: [{
      id: 'payment-a', clinic_id: 'clinic-a', patient_id: 'patient-a', package_id: 'package-a',
      appointment_id: null, amount: '3250.00', payment_method: 'upi', date: '2026-08-01', notes: null,
      created_at: '2026-08-01T00:00:00+00:00',
    }],
    appointment_payments: [{
      id: 'application-a', payment_id: 'payment-a', appointment_id: 'appointment-a',
      amount_applied: '650.00', created_at: '2026-08-01T00:00:00+00:00',
    }],
    package_session_allocations: [{
      id: 'allocation-a', package_id: 'package-a', appointment_id: 'appointment-a',
      created_at: '2026-08-01T00:00:00+00:00',
    }],
  }
}

test('live database fingerprint is versioned, deterministic, and covers all billing source rows', () => {
  const source = fixture()
  const first = buildLiveDatabaseFingerprint(source)
  const reordered = buildLiveDatabaseFingerprint({
    ...source,
    clinics: [...source.clinics].reverse(),
    global_settings: [...source.global_settings].reverse(),
  })

  assert.equal(LIVE_DB_FINGERPRINT_VERSION, 'carebook-billing-source-v1')
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.equal(first, reordered)

  const unrelatedAppointmentDrift = structuredClone(source)
  unrelatedAppointmentDrift.appointments[0]!.fee = '651.00'
  assert.notEqual(buildLiveDatabaseFingerprint(unrelatedAppointmentDrift), first)

  const unrelatedPaymentDrift = structuredClone(source)
  unrelatedPaymentDrift.payments[0]!.amount = '3249.00'
  assert.notEqual(buildLiveDatabaseFingerprint(unrelatedPaymentDrift), first)
  assert.deepEqual(buildBillingSourceRowCounts(source), {
    clinics: 2, patients: 1, appointment_types: 1, global_settings: 2, package_templates: 1,
    appointments: 1, packages: 1, payments: 1, appointment_payments: 1,
    package_session_allocations: 1,
  })
})

test('normalizes REST number and timestamp spellings to SQL canonical values', () => {
  const source = fixture()
  const alternate = structuredClone(source)
  alternate.appointments[0]!.fee = 650 as unknown as string
  alternate.appointments[0]!.created_at = '2026-08-01T00:00:00Z'
  alternate.payments[0]!.amount = 3250 as unknown as string

  assert.equal(buildLiveDatabaseFingerprint(alternate), buildLiveDatabaseFingerprint(source))
})
