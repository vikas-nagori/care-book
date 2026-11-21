import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import {
  applyMigrationsAfter, buildDatabaseThrough, dropDatabase, postgresAvailable,
  query, queryAsAuthenticated, run, seedUser,
} from './db.ts'

// Migration 20261121032844: one fee default for bookings the client does not price (patient's last
// non-cancelled, non-zero fee for the type, else the type rate), and invited External Staff who
// have not signed in yet can be shared patients.
const DB = 'carebook_it_booking_fee_default'
const previous = '20261120194728_external_staff_patient_access.sql'
const skip = postgresAvailable() ? false : 'no local Postgres reachable'
const clinicToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
const day = (offset: number) => {
  const date = new Date(`${clinicToday}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}
const as = (actor: string, sql: string) => queryAsAuthenticated(DB, actor, sql)
const suggest = (actor: string, patient: string, type: string) =>
  as(actor, `select coalesce(suggest_appointment_fee('${patient}', '${type}')::text, 'null')`)
const patient = (name: string) =>
  query(DB, `insert into patients (clinic_id, name, phone) values ('${clinic}', '${name}', '123') returning id`)
const appointment = (patientId: string, date: string, fee: number, status = 'scheduled', typeId = shared) =>
  as(admin, `insert into appointments (patient_id, date, time, appointment_type_id, status, fee)
    values ('${patientId}', '${date}', '09:00', '${typeId}', '${status}', ${fee}) returning id`)

let clinic: string, otherClinic: string, admin: string, staff: string, otherAdmin: string
let shared: string, restricted: string

before(() => {
  if (skip) return
  buildDatabaseThrough(DB, previous)
  clinic = query(DB, "insert into clinics (name) values ('Fees') returning id")
  otherClinic = query(DB, "insert into clinics (name) values ('Other') returning id")
  admin = seedUser(DB, 'admin', clinic)
  staff = seedUser(DB, 'staff', clinic)
  otherAdmin = seedUser(DB, 'admin', otherClinic)
  shared = query(DB, `update appointment_types set session_rate=800 where clinic_id='${clinic}' and is_shared returning id`)
  restricted = query(DB, `update appointment_types set session_rate=1500 where clinic_id='${clinic}' and not is_shared returning id`)
  applyMigrationsAfter(DB, previous)
})
after(() => { if (!skip) dropDatabase(DB) })

test("suggested fee is the patient's last non-cancelled, non-zero fee for the type, else the type rate", { skip }, () => {
  const p = patient('History')
  assert.equal(suggest(admin, p, shared), '800.00')
  appointment(p, day(-20), 1000, 'completed')
  appointment(p, day(-10), 1200, 'completed')
  assert.equal(suggest(admin, p, shared), '1200.00')
  appointment(p, day(-5), 2000, 'cancelled')
  appointment(p, day(-3), 0, 'completed')
  assert.equal(suggest(admin, p, shared), '1200.00', 'cancelled and zero-value sessions are ignored')
  assert.equal(suggest(admin, p, restricted), '1500.00', 'history is per appointment type')
  assert.equal(suggest(admin, patient('New'), shared), '800.00')
})

test('only clinic admins can read a suggested fee, and only for their own clinic', { skip }, () => {
  const p = patient('Private')
  appointment(p, day(-1), 1300, 'completed')
  assert.throws(() => suggest(staff, p, shared), /Access denied/)
  assert.equal(suggest(otherAdmin, p, shared), 'null')
  assert.throws(() => query(DB, `set role anon; select suggest_appointment_fee('${p}', '${shared}')`), /permission denied/)
  assert.throws(() => as(admin, `select private.default_appointment_fee('${clinic}', '${p}', '${shared}')`), /permission denied/)
})

test('staff bookings are priced from patient history instead of the bare type rate', { skip }, () => {
  const p = patient('Staff Booked')
  appointment(p, day(-7), 1100, 'completed')
  const id = as(staff, `insert into appointments (patient_id, date, time, appointment_type_id, fee)
    values ('${p}', '${day(1)}', '11:00', '${shared}', 1) returning id`)
  assert.equal(query(DB, `select fee || ':' || payment_status from appointments where id='${id}'`), '1100.00:unpaid')
  const fresh = patient('Staff New')
  const other = as(staff, `insert into appointments (patient_id, date, time, appointment_type_id, fee)
    values ('${fresh}', '${day(1)}', '12:00', '${shared}', 1) returning id`)
  assert.equal(query(DB, `select fee from appointments where id='${other}'`), '800.00')
  as(staff, `update appointments set fee = 5 where id='${id}'`)
  assert.equal(query(DB, `select fee from appointments where id='${id}'`), '1100.00', 'staff still cannot change a fee')
})

test('invited External Staff can be shared before first sign-in and their bookings use patient history', { skip }, () => {
  const p = patient('Coordinated')
  appointment(p, day(-4), 1250, 'completed')
  const invited = seedUser(DB, 'staff', clinic)
  const revoked = seedUser(DB, 'staff', clinic)
  run(DB, `update profiles set role='external_staff' where id in ('${invited}','${revoked}');
    insert into user_invites (clinic_id, email, role, status, invited_by, auth_user_id)
    select clinic_id, email, role, case when id='${invited}' then 'pending' else 'revoked' end, '${admin}', id
    from profiles where id in ('${invited}','${revoked}')`)

  as(admin, `select replace_patient_external_access('${p}', '{${invited}}'::uuid[])`)
  assert.equal(query(DB, `select count(*) from patient_external_access where patient_id='${p}'`), '1')
  assert.throws(() => as(admin, `select replace_patient_external_access('${p}', '{${revoked}}'::uuid[])`), /Choose active External Staff/)

  const request = { id: randomUUID(), patient_id: p, appointment_type_id: shared, date: day(2), time: '10:00', duration_minutes: 45 }
  const booked = JSON.parse(as(invited, `select external_create_appointment('${JSON.stringify(request)}'::jsonb)`))
  assert.equal(query(DB, `select fee from appointments where id='${booked.id}'`), '1250.00')
  assert.equal(booked.fee, undefined, 'External Staff never see the fee')
})
