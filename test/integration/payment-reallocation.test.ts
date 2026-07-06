// Re-deriving a patient's billing when a *paid* session changes. The allocation trigger fires on
// `after update of fee/status on appointments`, but historically it only ever paid off sessions still
// flagged `unpaid` — it never un-tied money from an already-paid session. So editing the fee of a
// paid session left the due/credit totals frozen. Migration 023 makes allocate_patient_payment_credit
// idempotent (clear the patient's non-cancelled ties, reset to unpaid, re-run FIFO from current
// state), so any fee/status edit re-derives correctly. These tests pin that behaviour.

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAs, seedUser } from './db.ts'

const DB = 'carebook_it_realloc'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let adminId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Realloc Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
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

/** A patient's unspent advance credit = Σ payments.amount − Σ appointment_payments.amount_applied. */
function unspentCredit(patient: string): number {
  return Number(
    query(
      DB,
      `select coalesce((select sum(amount) from payments where patient_id = '${patient}'), 0)
            - coalesce((
                select sum(ap.amount_applied)
                from appointment_payments ap
                join payments p on p.id = ap.payment_id
                where p.patient_id = '${patient}'
              ), 0)`
    )
  )
}

function paymentStatus(appt: string): string {
  return query(DB, `select payment_status from appointments where id = '${appt}'`)
}

function appliedTo(appt: string): number {
  return Number(query(DB, `select coalesce(sum(amount_applied), 0) from appointment_payments where appointment_id = '${appt}'`))
}

test('raising a paid session fee re-opens the balance', { skip }, () => {
  const patient = newPatient('Raise Fee')
  const appt = query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date - 1, '09:00', 'clinic', 'completed', 500) returning id`
  )
  rpc(adminId, `public.record_payment('${patient}', null, 500, 'cash', current_date, null)`)
  assert.equal(paymentStatus(appt), 'paid', 'precondition: ₹500 pays the ₹500 session')

  // The session was actually ₹700. The ₹500 pool can no longer cover it (all-or-nothing FIFO),
  // so it must fall back to unpaid, leaving ₹500 as credit and ₹200 net due.
  query(DB, `update appointments set fee = 700 where id = '${appt}'`)

  assert.equal(paymentStatus(appt), 'unpaid', 'the session should re-open as unpaid')
  assert.equal(appliedTo(appt), 0, 'no money should stay tied to the re-opened session')
  assert.equal(unspentCredit(patient), 500, 'the ₹500 should return to the credit pool')
})

test('lowering a paid session fee releases the overpayment as credit', { skip }, () => {
  const patient = newPatient('Lower Fee')
  const appt = query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date - 1, '09:00', 'clinic', 'completed', 500) returning id`
  )
  rpc(adminId, `public.record_payment('${patient}', null, 500, 'cash', current_date, null)`)
  assert.equal(paymentStatus(appt), 'paid')

  // The session was actually ₹300 — the ₹200 overpayment must be freed as credit.
  query(DB, `update appointments set fee = 300 where id = '${appt}'`)

  assert.equal(paymentStatus(appt), 'paid', 'the ₹500 still covers the ₹300 session')
  assert.equal(appliedTo(appt), 300, 'only the current ₹300 fee should stay tied to the session')
  assert.equal(unspentCredit(patient), 200, 'the ₹200 overpayment should surface as credit')
})

test('re-deriving money does not disturb package session usage', { skip }, () => {
  const patient = newPatient('Package Usage')
  const appt = query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date + 1, '10:00', 'home_visit', 'scheduled', 800) returning id`
  )
  rpc(
    adminId,
    `public.record_billing_entry('${patient}', 'package_with_payment', '10-pack', 10, 800, 'prepaid', 8000, 'cash', current_date, null)`
  )
  const usedBefore = query(DB, `select used_sessions from packages where patient_id = '${patient}'`)
  assert.equal(usedBefore, '1', 'the booked session is claimed by the package')

  // Editing the session fee triggers a money rebuild; the package quota counter must be untouched.
  query(DB, `update appointments set fee = 900 where id = '${appt}'`)
  const usedAfter = query(DB, `select used_sessions from packages where patient_id = '${patient}'`)
  assert.equal(usedAfter, usedBefore, 'used_sessions is package quota, not money, and must not change')
})

test('allocate_patient_payment_credit is idempotent', { skip }, () => {
  const patient = newPatient('Idempotent')
  const appt = query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date - 1, '09:00', 'clinic', 'completed', 400) returning id`
  )
  rpc(adminId, `public.record_payment('${patient}', null, 400, 'cash', current_date, null)`)

  const firstStatus = paymentStatus(appt)
  const firstApplied = appliedTo(appt)
  // Migration 022 moved the live allocation function into the private schema.
  query(DB, `select private.allocate_patient_payment_credit('${patient}')`)
  query(DB, `select private.allocate_patient_payment_credit('${patient}')`)

  assert.equal(paymentStatus(appt), firstStatus, 'status stable across repeated runs')
  assert.equal(appliedTo(appt), firstApplied, 'applied amount stable across repeated runs')
  assert.equal(
    query(DB, `select count(*) from appointment_payments where appointment_id = '${appt}'`),
    '1',
    'no duplicate ties accumulate'
  )
})
