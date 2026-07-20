import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildBillingTimelineItems,
  getBillingModeLabel,
  type BillingTimelinePackage,
  type BillingTimelinePayment,
} from './unified-billing.ts'

const packages: BillingTimelinePackage[] = [
  {
    id: 'package-older',
    clinic_id: 'clinic-1',
    patient_id: 'patient-1',
    name: '8 Session Package',
    total_sessions: 8,
    used_sessions: 2,
    total_amount: 4000,
    per_session_amount: 500,
    paid_amount: 1000,
    payment_timing: 'prepaid',
    status: 'active',
    created_at: '2026-04-10T08:00:00.000Z',
    patient: { id: 'patient-1', name: 'Asha Patel' },
  },
  {
    id: 'package-newer',
    clinic_id: 'clinic-1',
    patient_id: 'patient-2',
    name: 'Post Surgery Rehab',
    total_sessions: 12,
    used_sessions: 1,
    total_amount: 12000,
    per_session_amount: 1000,
    paid_amount: 2000,
    payment_timing: 'prepaid',
    status: 'active',
    created_at: '2026-04-13T08:00:00.000Z',
    patient: { id: 'patient-2', name: 'Rohan Mehta' },
  },
]

const payments: BillingTimelinePayment[] = [
  {
    id: 'payment-newest',
    clinic_id: 'clinic-1',
    patient_id: 'patient-1',
    package_id: 'package-older',
    appointment_id: null,
    amount: 1500,
    payment_method: 'upi',
    date: '2026-04-14',
    notes: 'advance',
    created_at: '2026-04-14T10:00:00.000Z',
    patient: { id: 'patient-1', name: 'Asha Patel' },
    package: { id: 'package-older', name: '8 Session Package' },
  },
  {
    id: 'payment-middle',
    clinic_id: 'clinic-1',
    patient_id: 'patient-2',
    package_id: null,
    appointment_id: null,
    amount: 700,
    payment_method: 'cash',
    date: '2026-04-12',
    notes: null,
    created_at: '2026-04-12T09:00:00.000Z',
    patient: { id: 'patient-2', name: 'Rohan Mehta' },
    package: null,
  },
]

test('buildBillingTimelineItems mixes packages and payments in newest-first order', () => {
  const result = buildBillingTimelineItems({
    packages,
    payments,
    linkedSessionCounts: {
      'payment-newest': 3,
    },
  })

  assert.deepEqual(result.map((item) => [item.type, item.id]), [
    ['payment_recorded', 'payment-newest'],
    ['package_created', 'package-newer'],
    ['payment_recorded', 'payment-middle'],
    ['package_created', 'package-older'],
  ])
})

test('buildBillingTimelineItems attaches linked session counts and package labels to payments', () => {
  const result = buildBillingTimelineItems({
    packages,
    payments,
    linkedSessionCounts: {
      'payment-newest': 3,
    },
  })

  const paymentItem = result.find((item) => item.id === 'payment-newest')

  assert.deepEqual(paymentItem, {
    id: 'payment-newest',
    type: 'payment_recorded',
    sortDate: '2026-04-14',
    patientName: 'Asha Patel',
    amount: 1500,
    paymentMethod: 'upi',
    notes: 'advance',
    packageName: '8 Session Package',
    linkedSessionCount: 3,
  })
})

test('buildBillingTimelineItems falls back for missing patient, package, and linked session data', () => {
  const result = buildBillingTimelineItems({
    packages: [
      {
        ...packages[0],
        id: 'package-without-patient',
        patient: null,
      },
    ],
    payments: [
      {
        ...payments[1],
        id: 'payment-without-patient',
        patient: null,
        package: null,
      },
    ],
    linkedSessionCounts: {},
  })

  const packageItem = result.find((item) => item.id === 'package-without-patient')
  const paymentItem = result.find((item) => item.id === 'payment-without-patient')

  assert.equal(packageItem?.patientName, 'Unknown patient')
  assert.equal(paymentItem?.patientName, 'Unknown patient')
  assert.equal(paymentItem?.type === 'payment_recorded' ? paymentItem.packageName : null, null)
  assert.equal(paymentItem?.type === 'payment_recorded' ? paymentItem.linkedSessionCount : null, 0)
})

test('getBillingModeLabel returns human-readable labels for simplified billing entry modes', () => {
  assert.equal(getBillingModeLabel('payment_only'), 'Only payment')
  assert.equal(getBillingModeLabel('package_with_payment'), 'Package + payment')
})
