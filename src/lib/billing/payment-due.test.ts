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

test('buildPaymentDueRows totals completed unpaid fees and subtracts unspent credit', () => {
  const rows = buildPaymentDueRows({
    appointments,
    payments,
    appointmentPayments: [
      { payment_id: 'payment-2', amount_applied: 100 },
    ],
  })

  assert.deepEqual(rows, [
    {
      patientId: 'patient-1',
      patientName: 'Asha Rao',
      unpaidSessionCount: 2,
      grossDue: 1200,
      unspentCredit: 450,
      netDue: 750,
      oldestDueDate: '2026-04-01',
      latestDueDate: '2026-04-05',
    },
  ])
})

test('buildPaymentDueRows floors net due at zero when credit covers gross due', () => {
  const rows = buildPaymentDueRows({
    appointments,
    payments,
    appointmentPayments: [],
  })

  assert.equal(rows.some((row) => row.patientId === 'patient-2'), false)
})
