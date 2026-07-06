import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPaymentDueRows, type PaymentDueAppointment, type PaymentDuePayment } from './payment-due.ts'

const appointments: PaymentDueAppointment[] = [
  {
    id: 'completed-unpaid-1',
    patient_id: 'patient-1',
    date: '2026-04-01',
    status: 'completed',
    payment_status: 'unpaid',
    fee: 500,
    patient: { id: 'patient-1', name: 'Asha Rao' },
  },
  {
    id: 'completed-unpaid-2',
    patient_id: 'patient-1',
    date: '2026-04-05',
    status: 'completed',
    payment_status: 'unpaid',
    fee: 700,
    patient: { id: 'patient-1', name: 'Asha Rao' },
  },
  {
    id: 'scheduled-unpaid',
    patient_id: 'patient-1',
    date: '2026-04-08',
    status: 'scheduled',
    payment_status: 'unpaid',
    fee: 900,
    patient: { id: 'patient-1', name: 'Asha Rao' },
  },
  {
    id: 'completed-paid',
    patient_id: 'patient-1',
    date: '2026-04-09',
    status: 'completed',
    payment_status: 'paid',
    fee: 400,
    patient: { id: 'patient-1', name: 'Asha Rao' },
  },
  {
    id: 'completed-zero',
    patient_id: 'patient-2',
    date: '2026-04-02',
    status: 'completed',
    payment_status: 'unpaid',
    fee: 0,
    patient: { id: 'patient-2', name: 'Bina Shah' },
  },
  {
    id: 'completed-other',
    patient_id: 'patient-2',
    date: '2026-04-03',
    status: 'completed',
    payment_status: 'unpaid',
    fee: 800,
    patient: { id: 'patient-2', name: 'Bina Shah' },
  },
]

const payments: PaymentDuePayment[] = [
  { id: 'payment-1', patient_id: 'patient-1', amount: 300 },
  { id: 'payment-2', patient_id: 'patient-1', amount: 250 },
  { id: 'payment-3', patient_id: 'patient-2', amount: 1200 },
]

test('buildPaymentDueRows totals due patients and surfaces credit balances', () => {
  const rows = buildPaymentDueRows({
    appointments,
    payments,
    appointmentPayments: [
      { payment_id: 'payment-2', amount_applied: 100 },
    ],
  })

  // patient-1 owes ₹1200 gross with ₹450 credit → ₹750 net due; patient-2's ₹1200 credit
  // overshoots its ₹800 gross by ₹400 → a credit balance. Due rows sort ahead of credit rows.
  assert.deepEqual(rows, [
    {
      patientId: 'patient-1',
      patientName: 'Asha Rao',
      unpaidSessionCount: 2,
      grossDue: 1200,
      unspentCredit: 450,
      netDue: 750,
      netCredit: 0,
      direction: 'due',
      oldestDueDate: '2026-04-01',
      latestDueDate: '2026-04-05',
    },
    {
      patientId: 'patient-2',
      patientName: 'Bina Shah',
      unpaidSessionCount: 1,
      grossDue: 800,
      unspentCredit: 1200,
      netDue: 0,
      netCredit: 400,
      direction: 'credit',
      oldestDueDate: '2026-04-03',
      latestDueDate: '2026-04-03',
    },
  ])
})

test('buildPaymentDueRows drops patients whose credit exactly settles their due', () => {
  const rows = buildPaymentDueRows({
    appointments: [
      {
        id: 'a1',
        patient_id: 'p-settled',
        date: '2026-04-01',
        status: 'completed',
        payment_status: 'unpaid',
        fee: 500,
        patient: { id: 'p-settled', name: 'Settled' },
      },
    ],
    payments: [{ id: 'pay', patient_id: 'p-settled', amount: 500 }],
    appointmentPayments: [],
  })

  assert.deepEqual(rows, [])
})

test('buildPaymentDueRows surfaces a credit-only patient using patientNames', () => {
  const rows = buildPaymentDueRows({
    appointments: [],
    payments: [{ id: 'pay', patient_id: 'p-credit', amount: 500 }],
    appointmentPayments: [],
    patientNames: { 'p-credit': 'Credit Only' },
  })

  assert.deepEqual(rows, [
    {
      patientId: 'p-credit',
      patientName: 'Credit Only',
      unpaidSessionCount: 0,
      grossDue: 0,
      unspentCredit: 500,
      netDue: 0,
      netCredit: 500,
      direction: 'credit',
      oldestDueDate: '',
      latestDueDate: '',
    },
  ])
})
