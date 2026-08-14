import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  assertApprovedBillingImpactPlan,
  buildBillingImpactReport,
  type BillingImpactInput,
  type BillingImpactPlan,
} from './impact-report.ts'

const CLINIC_ID = 'd36983a1-e62d-41bd-8c3a-dfbdb4ce7968'
const CLINIC_TYPE_ID = '2c08cb1e-13c2-4b86-be34-08a03cc6c399'
const SPINAL_TYPE_ID = '00000000-0000-4000-8000-000000000099'

function fixture(): { input: BillingImpactInput; plan: BillingImpactPlan } {
  const patients = [
    ['smita', 'Smita'],
    ['pranav', 'Pranav'],
    ['vikash', 'Vikash Mayflower'],
    ['sandeep', 'Sandeep Kumar Goyal'],
    ['nayana', 'Nayana Pai'],
    ['tresa', 'Tresa'],
    ['asha', 'Asha Quartz'],
  ].map(([id, name]) => ({ id, clinicId: CLINIC_ID, name }))
  const appointments: BillingImpactInput['appointments'] = []
  const packages: BillingImpactInput['packages'] = []
  const payments: BillingImpactInput['payments'] = []
  const allocations: BillingImpactInput['packageSessionAllocations'] = []

  function addPackage(
    patientId: string,
    id: string,
    total: number,
    completed: number,
    scheduled: number,
    received: number,
    start = '2026-07-01',
    perSession = 650,
  ) {
    packages.push({
      id,
      clinicId: CLINIC_ID,
      patientId,
      name: `${patientId} package`,
      totalSessions: total,
      usedSessions: 0,
      totalAmount: total * perSession,
      perSessionAmount: perSession,
      paidAmount: received,
      status: 'active',
      appointmentTypeId: CLINIC_TYPE_ID,
      startsOn: start,
      createdAt: `${start}T01:00:00Z`,
    })
    payments.push({
      id: `${id}-payment`, clinicId: CLINIC_ID, patientId, packageId: id,
      amount: received, paymentMethod: 'upi', date: start, createdAt: `${start}T02:00:00Z`,
    })
    for (let index = 0; index < completed + scheduled; index += 1) {
      const appointmentId = `${id}-appointment-${index}`
      const status = index < completed ? 'completed' : 'scheduled'
      appointments.push({
        id: appointmentId, clinicId: CLINIC_ID, patientId,
        appointmentTypeId: CLINIC_TYPE_ID, date: `2026-08-${String(index + 1).padStart(2, '0')}`,
        time: '10:00:00', status, fee: perSession,
        paymentStatus: index < completed ? 'paid' : 'unpaid', createdAt: '2026-07-01T00:00:00Z',
      })
      allocations.push({
        packageId: id, appointmentId,
        lifecycle: status === 'completed' ? 'availed' : 'scheduled',
        createdAt: '2026-07-01T00:00:00Z',
      })
    }
  }

  addPackage('smita', 'smita-package', 9, 9, 0, 6_000, '2026-07-15', 600)
  appointments.push({
    id: 'smita-spinal', clinicId: CLINIC_ID, patientId: 'smita', appointmentTypeId: SPINAL_TYPE_ID,
    date: '2026-07-16', time: '10:00:00', status: 'completed', fee: 500,
    paymentStatus: 'unpaid', createdAt: '2026-07-16T00:00:00Z',
  })

  addPackage('pranav', 'pranav-first', 5, 5, 0, 3_250, '2026-07-01')
  addPackage('pranav', 'pranav-second', 5, 5, 0, 3_200, '2026-07-28')
  addPackage('vikash', 'vikash-package', 5, 4, 1, 3_250)
  addPackage('sandeep', 'sandeep-package', 7, 3, 2, 4_550)
  addPackage('nayana', 'nayana-package', 5, 2, 1, 3_250)
  appointments.push({
    id: 'nayana-spinal', clinicId: CLINIC_ID, patientId: 'nayana', appointmentTypeId: SPINAL_TYPE_ID,
    date: '2026-08-15', time: '11:00:00', status: 'scheduled', fee: 500,
    paymentStatus: 'prepaid', createdAt: '2026-08-01T00:00:00Z',
  })
  addPackage('tresa', 'tresa-package', 5, 5, 0, 3_250)
  appointments.push({
    id: 'asha-unpaid', clinicId: CLINIC_ID, patientId: 'asha', appointmentTypeId: CLINIC_TYPE_ID,
    date: '2026-08-01', time: '09:00:00', status: 'completed', fee: 2_000,
    paymentStatus: 'unpaid', createdAt: '2026-08-01T00:00:00Z',
  })

  return {
    input: {
      clinics: [{ id: CLINIC_ID, name: 'Amruta' }],
      patients,
      appointmentTypes: [
        { id: CLINIC_TYPE_ID, clinicId: CLINIC_ID, name: 'Clinic', isDefault: true, isShared: true, sortOrder: 0 },
        { id: SPINAL_TYPE_ID, clinicId: CLINIC_ID, name: 'Spinal Bed', isDefault: false, isShared: false, sortOrder: 10 },
      ],
      appointments,
      packages,
      payments,
      appointmentPayments: [],
      packageSessionAllocations: allocations,
      refunds: [],
      refundReversals: [],
    },
    plan: {
      asOfDate: '2026-08-15',
      voidPaymentIds: ['smita-package-payment'],
      replacementPayments: [
        {
          id: 'smita-package-replacement', clinicId: CLINIC_ID, patientId: 'smita',
          packageId: 'smita-package', amount: 5_400, paymentMethod: 'upi', date: '2026-07-15',
          createdAt: '2026-07-15T02:00:01Z', fundingScope: 'package', status: 'posted',
        },
        {
          id: 'smita-ordinary-replacement', clinicId: CLINIC_ID, patientId: 'smita', packageId: null,
          amount: 600, paymentMethod: 'upi', date: '2026-07-15', createdAt: '2026-07-15T02:00:02Z',
          fundingScope: 'ordinary', status: 'posted',
        },
      ],
      refunds: [{
        id: 'smita-refund', clinicId: CLINIC_ID, patientId: 'smita',
        paymentId: 'smita-ordinary-replacement', amount: 100, refundMethod: 'upi',
        refundDate: '2026-07-30', reason: 'Approved historical correction', createdAt: '2026-07-30T00:00:00Z',
      }],
      packageOverrides: [{ packageId: 'pranav-second', startsOn: '2026-07-28' }],
    },
  }
}

test('reports every approved patient outcome with separate ordinary and package balances', () => {
  const { input, plan } = fixture()
  const report = buildBillingImpactReport(input, plan)
  const byName = new Map(report.patients.map((patient) => [patient.patientName, patient]))

  const smita = byName.get('Smita')!
  assert.deepEqual(
    smita.receipts.map(({ amount, fundingScope, status }) => ({ amount, fundingScope, status })),
    [
      { amount: 6000, fundingScope: 'package', status: 'voided' },
      { amount: 5400, fundingScope: 'package', status: 'posted' },
      { amount: 600, fundingScope: 'ordinary', status: 'posted' },
    ],
  )
  assert.equal(smita.ordinary.applied, 500)
  assert.equal(smita.ordinary.due, 0)
  assert.equal(smita.ordinary.refundableCredit, 0)
  assert.equal(smita.refunds[0]?.amount, 100)
  assert.equal(smita.packages[0]?.lifecycle, 'completed')

  const pranav = byName.get('Pranav')!
  assert.deepEqual(pranav.packages.map((pkg) => [pkg.lifecycle, pkg.availed, pkg.due]), [
    ['completed', 5, 0],
    ['completed', 5, 50],
  ])

  assert.deepEqual(byName.get('Vikash Mayflower')!.packages.map((pkg) => [pkg.availed, pkg.scheduled, pkg.remaining, pkg.lifecycle]), [[4, 1, 0, 'active']])
  assert.deepEqual(byName.get('Sandeep Kumar Goyal')!.packages.map((pkg) => [pkg.availed, pkg.scheduled, pkg.remaining, pkg.refundableCredit]), [[3, 2, 2, 1300]])
  assert.deepEqual(byName.get('Nayana Pai')!.packages.map((pkg) => [pkg.availed, pkg.scheduled, pkg.remaining, pkg.refundableCredit]), [[2, 1, 2, 1300]])
  assert.equal(byName.get('Nayana Pai')!.appointmentBadgeChanges.find((row) => row.appointmentId === 'nayana-spinal')?.expected, 'unpaid')
  assert.equal(byName.get('Tresa')!.packages[0]?.lifecycle, 'completed')
  assert.equal(byName.get('Asha Quartz')!.ordinary.due, 2000)
  assert.deepEqual(report.invariantFailures, [])
})

test('is deterministic regardless of input row order and exposes stable checksums', () => {
  const { input, plan } = fixture()
  const first = buildBillingImpactReport(input, plan)
  const reversed = buildBillingImpactReport({
    ...input,
    patients: [...input.patients].reverse(),
    appointments: [...input.appointments].reverse(),
    packages: [...input.packages].reverse(),
    payments: [...input.payments].reverse(),
    packageSessionAllocations: [...input.packageSessionAllocations].reverse(),
  }, plan)

  assert.equal(first.inputFingerprint, reversed.inputFingerprint)
  assert.equal(first.reportChecksum, reversed.reportChecksum)
  assert.deepEqual(first.patients, reversed.patients)
})

test('keeps the live-data fingerprint independent from the approved plan', () => {
  const { input, plan } = fixture()
  const first = buildBillingImpactReport(input, plan)
  const changedPlan = buildBillingImpactReport(input, { ...plan, asOfDate: '2026-08-16' })
  assert.equal(first.inputFingerprint, changedPlan.inputFingerprint)
  assert.notEqual(first.planFingerprint, changedPlan.planFingerprint)
})

test('surfaces plan mismatches instead of silently omitting corrections', () => {
  const { input, plan } = fixture()
  plan.voidPaymentIds = ['missing-payment']
  const report = buildBillingImpactReport(input, plan)
  assert.match(report.invariantFailures.join('\n'), /missing-payment/)
})

test('fails the gate when a named approved outcome no longer matches source data', () => {
  const { input, plan } = fixture()
  plan.expectedOutcomes = [{
    patientId: 'asha',
    ordinary: { due: 1_900 },
  }]
  const report = buildBillingImpactReport(input, plan)
  assert.match(report.invariantFailures.join('\n'), /asha ordinary due: expected 1900, calculated 2000/)
})

test('rejects an empty or undated correction plan at the CLI gate', () => {
  assert.throws(() => assertApprovedBillingImpactPlan({ asOfDate: '' }), /approved as-of date/)
  assert.throws(() => assertApprovedBillingImpactPlan({ asOfDate: '2026-08-15' }), /approved correction operations/)
  const { plan } = fixture()
  plan.expectedOutcomes = [{ patientId: 'smita' }]
  assert.doesNotThrow(() => assertApprovedBillingImpactPlan(plan))
})

test('does not let a released v2 allocation shield an appointment from ordinary FIFO', () => {
  const { input, plan } = fixture()
  input.appointments.push({
    id: 'nayana-released-clinic', clinicId: CLINIC_ID, patientId: 'nayana', appointmentTypeId: CLINIC_TYPE_ID,
    date: '2026-08-12', time: '08:00:00', status: 'completed', fee: 650,
    paymentStatus: 'unpaid', createdAt: '2026-08-12T00:00:00Z',
  })
  input.packageSessionAllocations.push({
    packageId: 'nayana-package', appointmentId: 'nayana-released-clinic', lifecycle: 'released',
    createdAt: '2026-08-12T00:00:00Z',
  })
  input.payments.push({
    id: 'nayana-ordinary', clinicId: CLINIC_ID, patientId: 'nayana', packageId: null,
    amount: 650, paymentMethod: 'upi', date: '2026-08-11', createdAt: '2026-08-11T00:00:00Z',
  })
  const report = buildBillingImpactReport(input, plan)
  const nayana = report.patients.find((patient) => patient.patientId === 'nayana')!
  assert.equal(nayana.ordinary.applied, 650)
  assert.equal(nayana.appointmentBadgeChanges.find((change) => change.appointmentId === 'nayana-released-clinic')?.expected, 'paid')
})
