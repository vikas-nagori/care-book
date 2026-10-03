// Legacy delete RPC names now preserve the financial record and perform audited void/cancel
// transitions. Reconciliation still releases applications/reservations oldest-first.

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAs, seedUser } from './db.ts'

const DB = 'carebook_it_delete_billing'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let adminId = ''
let staffId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Delete Billing Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  staffId = seedUser(DB, 'staff', clinicId)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function newPatient(label: string): string {
  return query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', '${label}', '1') returning id`)
}

function rpc(userId: string, expr: string): Record<string, unknown> {
  return JSON.parse(queryAs(DB, userId, `select ${expr}`))
}

function paymentStatus(appt: string): string {
  return query(DB, `select payment_status from appointments where id = '${appt}'`)
}

function completedSession(patient: string, daysAgo: number, fee: number): string {
  return query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date - ${daysAgo}, '09:00', 'clinic', 'completed', ${fee}) returning id`
  )
}

test('legacy payment deletion voids the receipt and leaves the newest completed session unpaid', { skip }, () => {
  const patient = newPatient('Delete Payment')
  // Three ₹500 completed sessions, oldest → newest.
  const oldest = completedSession(patient, 3, 500)
  const middle = completedSession(patient, 2, 500)
  const newest = completedSession(patient, 1, 500)

  // Two payments totalling ₹1500 cover all three sessions.
  rpc(adminId, `public.record_payment('${patient}', null, 1000, 'cash', current_date - 2, null)`)
  const later = rpc(adminId, `public.record_payment('${patient}', null, 500, 'cash', current_date, null)`)
  assert.equal(paymentStatus(oldest), 'paid')
  assert.equal(paymentStatus(middle), 'paid')
  assert.equal(paymentStatus(newest), 'paid')

  // Void the more recent ₹500 payment: the ₹1000 pool now only covers the two oldest sessions.
  const del = rpc(adminId, `public.delete_payment('${later.paymentId}')`)
  assert.equal(del.success, true)
  assert.equal(del.patientId, patient)

  assert.equal(paymentStatus(oldest), 'paid', 'oldest stays paid')
  assert.equal(paymentStatus(middle), 'paid', 'middle stays paid')
  assert.equal(paymentStatus(newest), 'unpaid', 'newest completed session falls back to unpaid')
  assert.equal(
    query(DB, `select status from payments where id = '${later.paymentId}'`),
    'voided',
    'the immutable payment row is retained as voided'
  )
})

test('legacy package deletion cancels it, releases its session, and voids its payment', { skip }, () => {
  const patient = newPatient('Delete Package')
  const session = query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date + 1, '10:00', 'home_visit', 'scheduled', 800) returning id`
  )
  const entry = rpc(
    adminId,
    `public.record_billing_entry_v2(
      '${patient}', 'package_with_payment', '10-pack', 10, 800,
      (select id from appointment_types where clinic_id = '${clinicId}' and name = 'Home'),
      current_date, 8000, 'cash', current_date, null
    )`
  )
  assert.equal(paymentStatus(session), 'prepaid', 'the ₹8000 prepays the booked session')
  const packageId = entry.packageId as string

  const del = rpc(adminId, `public.delete_package('${packageId}')`)
  assert.equal(del.success, true)
  assert.equal(del.patientId, patient)

  assert.equal(query(DB, `select status from packages where id = '${packageId}'`), 'cancelled', 'package is retained as cancelled')
  assert.equal(
    query(DB, `select status || '/' || void_reason from payments where id = '${entry.paymentId}'`),
    'voided/Legacy delete request converted to audited cancellation',
    'the linked payment is voided with the package, its row retained'
  )
  assert.equal(paymentStatus(session), 'unpaid', 'the session reverts to unpaid once the money is gone')
})

test('staff cannot delete payments', { skip }, () => {
  const patient = newPatient('Staff Delete Guard')
  completedSession(patient, 1, 500)
  const payment = rpc(adminId, `public.record_payment('${patient}', null, 500, 'cash', current_date, null)`)

  const del = rpc(staffId, `public.delete_payment('${payment.paymentId}')`)
  assert.equal(del.success, false, 'staff role is rejected')
  assert.equal(
    query(DB, `select count(*) from payments where id = '${payment.paymentId}'`),
    '1',
    'the payment is untouched'
  )
})
