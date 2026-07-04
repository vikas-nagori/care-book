// Appointment lifecycle flows that re-run the billing engine: cancellation untallies a session's
// payment links (migration 008) and deletion re-allocates the freed credit (migration 011).

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAs, seedUser } from './db.ts'

const DB = 'carebook_it_lifecycle'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let adminId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Lifecycle Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function newPatient(label: string): string {
  return query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', '${label}', '1') returning id`)
}

function pay(patient: string, amount: number): void {
  queryAs(DB, adminId, `select public.record_payment('${patient}', null, ${amount}, 'cash', current_date, null)`)
}

function bookSession(patient: string, dayOffset: number, fee: number): string {
  return query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date + ${dayOffset}, '10:00', 'clinic', 'scheduled', ${fee}) returning id`
  )
}

test('cancelling a prepaid session untallies its payment links', { skip }, () => {
  const patient = newPatient('Cancel')
  const appt = bookSession(patient, 1, 500)
  pay(patient, 500)
  assert.equal(query(DB, `select payment_status from appointments where id = '${appt}'`), 'prepaid')

  query(DB, `update appointments set status = 'cancelled' where id = '${appt}'`)

  assert.equal(query(DB, `select payment_status from appointments where id = '${appt}'`), 'unpaid')
  assert.equal(
    query(DB, `select count(*) from appointment_payments where appointment_id = '${appt}'`),
    '0',
    'cancellation should remove the appointment payment links'
  )
})

test('deleting a prepaid session re-allocates its credit to the next session', { skip }, () => {
  const patient = newPatient('Delete Resync')
  const first = bookSession(patient, 1, 500)
  const second = bookSession(patient, 2, 500)
  pay(patient, 500) // covers only the earliest session

  assert.equal(query(DB, `select payment_status from appointments where id = '${first}'`), 'prepaid')
  assert.equal(query(DB, `select payment_status from appointments where id = '${second}'`), 'unpaid')

  query(DB, `delete from appointments where id = '${first}'`)

  // The AFTER DELETE resync trigger frees the credit and prepays the remaining session.
  assert.equal(
    query(DB, `select payment_status from appointments where id = '${second}'`),
    'prepaid',
    'freed credit should re-allocate to the surviving session'
  )
})
