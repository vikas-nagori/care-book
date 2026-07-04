// Payments + billing flows through the real Postgres RPCs the app calls (record_payment,
// record_billing_entry). Both are admin-only and return a {success, ...} JSON envelope rather than
// throwing, so tests act as an admin user via the auth.uid() claim and assert on that envelope plus
// the resulting allocation state (payment_status, appointment_payments, package usage).

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAs, seedUser } from './db.ts'

const DB = 'carebook_it_payments'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let adminId = ''
let staffId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  adminId = seedUser(DB, 'admin')
  staffId = seedUser(DB, 'staff')
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function newPatient(label: string): string {
  return query(DB, `insert into patients (name, phone) values ('${label}', '1') returning id`)
}

/** Call an RPC as the given user and parse the JSON envelope. */
function rpc(userId: string, expr: string): Record<string, unknown> {
  return JSON.parse(queryAs(DB, userId, `select ${expr}`))
}

test('record_payment is rejected for non-admin users', { skip }, () => {
  const patient = newPatient('Staff Blocked')
  const res = rpc(staffId, `public.record_payment('${patient}', null, 500, 'cash', current_date, null)`)
  assert.equal(res.success, false)
  assert.equal(res.errorCode, '42501', 'should fail authorization')
})

test('record_payment rejects a non-positive amount', { skip }, () => {
  const patient = newPatient('Bad Amount')
  const res = rpc(adminId, `public.record_payment('${patient}', null, 0, 'cash', current_date, null)`)
  assert.equal(res.success, false)
  assert.equal(res.errorCode, '22023')
})

test('a payment settles a completed unpaid session', { skip }, () => {
  const patient = newPatient('Settle Completed')
  const appt = query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date - 1, '09:00', 'clinic', 'completed', 500) returning id`
  )

  const res = rpc(adminId, `public.record_payment('${patient}', null, 500, 'cash', current_date, null)`)
  assert.equal(res.success, true)

  assert.equal(query(DB, `select payment_status from appointments where id = '${appt}'`), 'paid')
  assert.equal(
    query(DB, `select count(*) from appointment_payments where appointment_id = '${appt}'`),
    '1'
  )
})

test('credit pools across payments to cover one session', { skip }, () => {
  const patient = newPatient('Pooled')
  const appt = query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date - 1, '09:00', 'clinic', 'completed', 150) returning id`
  )

  // First ₹100 cannot cover the ₹150 session (all-or-nothing), so it stays unpaid.
  rpc(adminId, `public.record_payment('${patient}', null, 100, 'cash', current_date, null)`)
  assert.equal(query(DB, `select payment_status from appointments where id = '${appt}'`), 'unpaid')

  // Second ₹100 lifts the pool to ₹200; the session is now drawn across both payments.
  rpc(adminId, `public.record_payment('${patient}', null, 100, 'cash', current_date, null)`)
  assert.equal(query(DB, `select payment_status from appointments where id = '${appt}'`), 'paid')
  assert.equal(
    query(DB, `select count(*) from appointment_payments where appointment_id = '${appt}'`),
    '2',
    'the fee should be funded by both payments'
  )
})

test('record_billing_entry creates a package, claims a booked session, and records the payment', { skip }, () => {
  const patient = newPatient('Package Entry')
  // A matching ₹800 session is booked first so the new package can claim it.
  query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date + 1, '10:00', 'home_visit', 'scheduled', 800)`
  )

  const res = rpc(
    adminId,
    `public.record_billing_entry('${patient}', 'package_with_payment', '10-pack', 10, 800, 'prepaid', 8000, 'cash', current_date, null)`
  )
  assert.equal(res.success, true)

  const pkg = query(
    DB,
    `select used_sessions || '/' || total_sessions || ' paid=' || paid_amount
     from packages where patient_id = '${patient}'`
  )
  assert.equal(pkg, '1/10 paid=8000.00', 'package should claim the booked session and bank the payment')
})
