import test from 'node:test'
import assert from 'node:assert/strict'

import {
  calculatePackageTotal,
  getPackageSessionCandidates,
  getPaymentAllocationPreview,
  getPaymentCandidates,
  getSessionsToCover,
  sumAppointmentFees,
  type PaymentCandidate,
} from './payment-helpers.ts'

const appointments: PaymentCandidate[] = [
  {
    id: 'a-completed-1',
    patient_id: 'patient-1',
    date: '2026-04-10',
    status: 'completed',
    payment_status: 'unpaid',
    fee: 500,
  },
  {
    id: 'a-completed-2',
    patient_id: 'patient-1',
    date: '2026-04-11',
    status: 'completed',
    payment_status: 'paid',
    fee: 500,
  },
  {
    id: 'a-scheduled-1',
    patient_id: 'patient-1',
    date: '2026-04-20',
    status: 'scheduled',
    payment_status: 'unpaid',
    fee: 600,
  },
  {
    id: 'a-scheduled-2',
    patient_id: 'patient-1',
    date: '2026-04-21',
    status: 'scheduled',
    payment_status: 'unpaid',
    fee: 400,
  },
  {
    id: 'a-other-patient',
    patient_id: 'patient-2',
    date: '2026-04-20',
    status: 'scheduled',
    payment_status: 'unpaid',
    fee: 400,
  },
  {
    id: 'a-missing-fee',
    patient_id: 'patient-1',
    date: '2026-04-22',
    status: 'scheduled',
    payment_status: 'unpaid',
    fee: null,
  },
]

test('getPaymentCandidates returns completed unpaid sessions for postpaid payments', () => {
  const result = getPaymentCandidates({
    appointments,
    patientId: 'patient-1',
    paymentTiming: 'postpaid',
    today: '2026-04-18',
  })

  assert.deepEqual(result.map((appointment) => appointment.id), ['a-completed-1'])
})

test('getPaymentCandidates returns upcoming unpaid sessions with positive fees for prepaid payments', () => {
  const result = getPaymentCandidates({
    appointments,
    patientId: 'patient-1',
    paymentTiming: 'prepaid',
    today: '2026-04-18',
  })

  assert.deepEqual(result.map((appointment) => appointment.id), [
    'a-scheduled-1',
    'a-scheduled-2',
  ])
})

test('getSessionsToCover accumulates fees instead of assuming every session costs the same amount', () => {
  const candidates = getPaymentCandidates({
    appointments,
    patientId: 'patient-1',
    paymentTiming: 'prepaid',
    today: '2026-04-18',
  })

  const result = getSessionsToCover({
    amount: 1000,
    candidates,
  })

  assert.deepEqual(result.map((appointment) => appointment.id), [
    'a-scheduled-1',
    'a-scheduled-2',
  ])
  assert.equal(sumAppointmentFees(result), 1000)
})

test('getSessionsToCover stops before a session that would exceed the recorded amount', () => {
  const candidates = getPaymentCandidates({
    appointments,
    patientId: 'patient-1',
    paymentTiming: 'prepaid',
    today: '2026-04-18',
  })

  const result = getSessionsToCover({
    amount: 700,
    candidates,
  })

  assert.deepEqual(result.map((appointment) => appointment.id), ['a-scheduled-1'])
  assert.equal(sumAppointmentFees(result), 600)
})

test('getSessionsToCover returns no sessions for non-positive payment amounts', () => {
  const candidates = getPaymentCandidates({
    appointments,
    patientId: 'patient-1',
    paymentTiming: 'prepaid',
    today: '2026-04-18',
  })

  assert.deepEqual(getSessionsToCover({ amount: 0, candidates }), [])
  assert.deepEqual(getSessionsToCover({ amount: -100, candidates }), [])
})

test('getPaymentAllocationPreview treats invalid payment amounts as zero allocation', () => {
  const result = getPaymentAllocationPreview({
    appointments,
    patientId: 'patient-1',
    amount: Number.NaN,
    today: '2026-04-18',
  })

  assert.deepEqual(result.outstandingSessions, [])
  assert.deepEqual(result.prepaidSessions, [])
  assert.equal(result.outstandingTotal, 0)
  assert.equal(result.prepaidTotal, 0)
  assert.equal(result.allocatedTotal, 0)
  assert.equal(result.remainingCredit, 0)
})

test('sumAppointmentFees treats missing appointment fees as zero', () => {
  assert.equal(sumAppointmentFees([
    appointments[0],
    appointments[2],
    appointments[5],
  ]), 1100)
})

test('getPaymentAllocationPreview covers completed sessions before future sessions across months', () => {
  const crossMonthAppointments: PaymentCandidate[] = [
    {
      id: 'may-scheduled-1',
      patient_id: 'patient-1',
      date: '2026-05-02',
      status: 'scheduled',
      payment_status: 'unpaid',
      fee: 700,
    },
    {
      id: 'april-completed-1',
      patient_id: 'patient-1',
      date: '2026-04-29',
      status: 'completed',
      payment_status: 'unpaid',
      fee: 1000,
    },
    {
      id: 'may-scheduled-2',
      patient_id: 'patient-1',
      date: '2026-05-06',
      status: 'scheduled',
      payment_status: 'unpaid',
      fee: 800,
    },
    {
      id: 'april-completed-2',
      patient_id: 'patient-1',
      date: '2026-04-30',
      status: 'completed',
      payment_status: 'unpaid',
      fee: 1200,
    },
  ]

  const result = getPaymentAllocationPreview({
    appointments: crossMonthAppointments,
    patientId: 'patient-1',
    amount: 3200,
    today: '2026-05-01',
  })

  assert.deepEqual(result.outstandingSessions.map((appointment) => appointment.id), [
    'april-completed-1',
    'april-completed-2',
  ])
  assert.deepEqual(result.prepaidSessions.map((appointment) => appointment.id), [
    'may-scheduled-1',
  ])
  assert.equal(result.outstandingTotal, 2200)
  assert.equal(result.prepaidTotal, 700)
  assert.equal(result.allocatedTotal, 2900)
  assert.equal(result.remainingCredit, 300)
})

test('getPaymentAllocationPreview leaves partial session money as advance credit', () => {
  const result = getPaymentAllocationPreview({
    appointments,
    patientId: 'patient-1',
    amount: 550,
    today: '2026-04-18',
  })

  assert.deepEqual(result.outstandingSessions.map((appointment) => appointment.id), [
    'a-completed-1',
  ])
  assert.deepEqual(result.prepaidSessions.map((appointment) => appointment.id), [])
  assert.equal(result.allocatedTotal, 500)
  assert.equal(result.remainingCredit, 50)
})

test('getPaymentAllocationPreview pools existing credit with the new amount to cover a session neither covers alone', () => {
  const sessions: PaymentCandidate[] = [
    {
      id: 'completed-500',
      patient_id: 'patient-1',
      date: '2026-04-10',
      status: 'completed',
      payment_status: 'unpaid',
      fee: 500,
    },
  ]

  // New amount alone (300) cannot cover the 500 session...
  const withoutCredit = getPaymentAllocationPreview({
    appointments: sessions,
    patientId: 'patient-1',
    amount: 300,
    today: '2026-04-18',
  })
  assert.deepEqual(withoutCredit.outstandingSessions, [])
  assert.equal(withoutCredit.remainingCredit, 300)

  // ...but pooled with 300 of existing unspent credit it does.
  const withCredit = getPaymentAllocationPreview({
    appointments: sessions,
    patientId: 'patient-1',
    amount: 300,
    today: '2026-04-18',
    existingCredit: 300,
  })
  assert.deepEqual(withCredit.outstandingSessions.map((a) => a.id), ['completed-500'])
  assert.equal(withCredit.allocatedTotal, 500)
  assert.equal(withCredit.remainingCredit, 100)
})

test('getPaymentAllocationPreview shows only the sessions the new payment newly covers beyond existing credit', () => {
  const sessions: PaymentCandidate[] = [
    {
      id: 'completed-a',
      patient_id: 'patient-1',
      date: '2026-04-10',
      status: 'completed',
      payment_status: 'unpaid',
      fee: 500,
    },
    {
      id: 'completed-b',
      patient_id: 'patient-1',
      date: '2026-04-11',
      status: 'completed',
      payment_status: 'unpaid',
      fee: 500,
    },
  ]

  // Existing credit already funds the first session; the new payment funds only the second.
  const result = getPaymentAllocationPreview({
    appointments: sessions,
    patientId: 'patient-1',
    amount: 500,
    today: '2026-04-18',
    existingCredit: 500,
  })

  assert.deepEqual(result.outstandingSessions.map((a) => a.id), ['completed-b'])
  assert.equal(result.allocatedTotal, 500)
  assert.equal(result.remainingCredit, 0)
})

test('calculatePackageTotal multiplies sessions by per-session charge', () => {
  assert.equal(calculatePackageTotal(8, 750), 6000)
  assert.equal(calculatePackageTotal(0, 750), 0)
  assert.equal(calculatePackageTotal(8, Number.NaN), 0)
  assert.equal(calculatePackageTotal(Number.NaN, 750), 0)
  assert.equal(calculatePackageTotal(8, -1), 0)
})

test('getPackageSessionCandidates orders eligible patient sessions across month boundaries', () => {
  const crossMonthAppointments: PaymentCandidate[] = [
    {
      id: 'may-scheduled',
      patient_id: 'patient-1',
      date: '2026-05-02',
      status: 'scheduled',
      payment_status: 'unpaid',
      fee: 700,
    },
    {
      id: 'april-completed',
      patient_id: 'patient-1',
      date: '2026-04-30',
      status: 'completed',
      payment_status: 'unpaid',
      fee: 1000,
    },
    {
      id: 'cancelled',
      patient_id: 'patient-1',
      date: '2026-04-29',
      status: 'cancelled',
      payment_status: 'unpaid',
      fee: 1000,
    },
  ]

  const result = getPackageSessionCandidates({
    appointments: crossMonthAppointments,
    patientId: 'patient-1',
  })

  assert.deepEqual(result.map((appointment) => appointment.id), [
    'april-completed',
    'may-scheduled',
  ])
})
