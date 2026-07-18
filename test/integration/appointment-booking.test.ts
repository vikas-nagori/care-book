// End-to-end booking tests against a real local Postgres built from schema.sql + migrations.
//
// These reproduce the production bug "record \"appointment_row\" is not assigned yet": booking an
// appointment fires the appointments_sync_patient_billing_allocations AFTER INSERT trigger, which
// runs assign_patient_package_sessions() and allocate_patient_payment_credit(). Before migration
// 015 those functions reused `appointment_row` as both a record variable and a table alias, so any
// insert for a patient with package/payment credit threw. A string-only migration test cannot catch
// that — only executing the DDL against Postgres does.

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query } from './db.ts'

const DB = 'carebook_it_booking'
const hasPostgres = postgresAvailable()

let clinicId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Booking Clinic') returning id`)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

// Each test seeds its own patient so cases stay independent within the shared database.
function newPatient(label: string): string {
  return query(
    DB,
    `insert into patients (clinic_id, name, phone) values ('${clinicId}', '${label}', '0000000000') returning id`
  )
}

test('booking for a patient with payment credit succeeds and is prepaid', { skip: skipReason() }, () => {
  const patient = newPatient('Credit Patient')

  // ₹1000 of credit on file, no appointments yet.
  query(
    DB,
    `insert into payments (patient_id, amount, payment_method, date)
     values ('${patient}', 1000, 'cash', current_date)`
  )

  // Booking a ₹500 upcoming session triggers the billing engine. Pre-015 this raised
  // "record \"appointment_row\" is not assigned yet" and no row was written.
  query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date + 1, '10:00', 'clinic', 'scheduled', 500)`
  )

  const count = query(DB, `select count(*) from appointments where patient_id = '${patient}'`)
  assert.equal(count, '1', 'appointment row should have been inserted')

  const status = query(
    DB,
    `select payment_status from appointments where patient_id = '${patient}'`
  )
  assert.equal(status, 'prepaid', 'existing credit should prepay the upcoming session')
})

test('booking for a patient with an active package consumes a package slot', { skip: skipReason() }, () => {
  const patient = newPatient('Package Patient')

  query(
    DB,
    `insert into packages (patient_id, name, total_sessions, total_amount, per_session_amount, status)
     values ('${patient}', '10-pack', 10, 8000, 800, 'active')`
  )

  // Exercises assign_patient_package_sessions() (the other function fixed by 015).
  const apptId = query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date + 2, '11:00', 'home_visit', 'scheduled', 800)
     returning id`
  )

  const allocated = query(
    DB,
    `select count(*) from package_session_allocations where appointment_id = '${apptId}'`
  )
  assert.equal(allocated, '1', 'the booked session should be claimed into the package')
})

test('bulk booking creates every session and runs package allocation for each row', { skip: skipReason() }, () => {
  const patient = newPatient('Recurring Package Patient')

  query(
    DB,
    `insert into packages (patient_id, name, total_sessions, total_amount, per_session_amount, status)
     values ('${patient}', 'Recurring 10-pack', 10, 8000, 800, 'active')`
  )

  query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values
       ('${patient}', current_date + 3, '08:30', 'clinic', 'scheduled', 800),
       ('${patient}', current_date + 5, '08:30', 'clinic', 'scheduled', 800),
       ('${patient}', current_date + 7, '08:30', 'clinic', 'scheduled', 800)`
  )

  const appointmentCount = query(
    DB,
    `select count(*) from appointments where patient_id = '${patient}'`
  )
  assert.equal(appointmentCount, '3', 'the multi-row insert should create the complete series')

  const allocationCount = query(
    DB,
    `select count(*)
     from package_session_allocations allocation
     join appointments appointment on appointment.id = allocation.appointment_id
     where appointment.patient_id = '${patient}'`
  )
  assert.equal(allocationCount, '3', 'each inserted session should run package allocation triggers')
})

test('booking for a patient with no credit succeeds and stays unpaid', { skip: skipReason() }, () => {
  const patient = newPatient('Cash Patient')

  query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date + 1, '12:00', 'clinic', 'scheduled', 500)`
  )

  const status = query(
    DB,
    `select payment_status from appointments where patient_id = '${patient}'`
  )
  assert.equal(status, 'unpaid', 'no credit means the session remains unpaid')
})

test('a legacy home_visit slug resolves and unknown types are rejected', { skip: skipReason() }, () => {
  const patient = newPatient('Home Visit Patient')

  // The legacy slug still resolves to the seeded "Home" type (migration 028 trigger).
  const apptId = query(
    DB,
    `insert into appointments (patient_id, date, time, type, status, fee)
     values ('${patient}', current_date + 1, '09:00', 'home_visit', 'scheduled', 1000)
     returning id`
  )
  assert.ok(apptId, 'home_visit should resolve to the default Home Visit type')

  let rejection = ''
  try {
    query(
      DB,
      `insert into appointments (patient_id, date, time, type, status, fee)
       values ('${patient}', current_date + 1, '09:30', 'not_a_type', 'scheduled', 100)`
    )
  } catch (err) {
    rejection = (err as { stderr?: string }).stderr ?? (err as Error).message
  }
  assert.match(
    rejection,
    /was not found for this clinic/,
    'unknown appointment types must still be rejected',
  )
})

function skipReason(): string | false {
  return hasPostgres ? false : 'no local Postgres reachable (set PGHOST/PGUSER or start Postgres)'
}
