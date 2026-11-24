import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import {
  applyMigrationsAfter, buildDatabaseThrough, dropDatabase, postgresAvailable,
  query, queryAsAuthenticated, run, seedUser,
} from './db.ts'

// Migration 20261124130000: External Staff cannot reschedule a past-dated session that is still
// 'scheduled' only because the nightly auto-complete job has not reached it yet. The job runs at
// 23:59 IST and completes rows dated before that day, so yesterday's sessions stay 'scheduled'
// all of today. Moving one forward would dodge its charge, exactly as cancelling it would.
const DB = 'carebook_it_external_past_reschedule'
const previous = '20261124120000_patient_age.sql'
const skip = postgresAvailable() ? false : 'no local Postgres reachable'
const clinicToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
const day = (offset: number) => {
  const date = new Date(`${clinicToday}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}
const as = (actor: string, sql: string) => queryAsAuthenticated(DB, actor, sql)
const update = (actor: string, request: Record<string, unknown>) =>
  JSON.parse(as(actor, `select external_update_appointment('${JSON.stringify(request)}'::jsonb)`))
const row = (id: string, columns: string) => query(DB, `select ${columns} from appointments where id='${id}'`)

type Booking = { id: string; patient_id: string; appointment_type_id: string; date: string; time: string; duration_minutes: number }
const intent = (booking: Booking, changes: Record<string, unknown> = {}) => ({
  id: booking.id, appointment_type_id: booking.appointment_type_id, date: booking.date,
  time: booking.time.slice(0, 5), duration_minutes: booking.duration_minutes, status: 'scheduled', ...changes,
})

let clinic: string, admin: string, external: string, shared: string, restricted: string, patient: string

/** A booking made through the real RPC, then moved to `date` as the clock passing would. */
function sessionOn(date: string, time: string): Booking {
  const booked = JSON.parse(as(external, `select external_create_appointment('${JSON.stringify({
    id: randomUUID(), patient_id: patient, appointment_type_id: shared, date: day(1), time, duration_minutes: 45,
  })}'::jsonb)`)) as Booking
  run(DB, `update appointments set date = '${date}' where id = '${booked.id}'`)
  return { ...booked, date }
}

before(() => {
  if (skip) return
  buildDatabaseThrough(DB, previous)
  clinic = query(DB, "insert into clinics (name) values ('Past Reschedule') returning id")
  admin = seedUser(DB, 'admin', clinic)
  external = seedUser(DB, 'staff', clinic)
  run(DB, `update profiles set role='external_staff' where id = '${external}'`)
  shared = query(DB, `update appointment_types set session_rate=800 where clinic_id='${clinic}' and is_shared returning id`)
  restricted = query(DB, `select id from appointment_types where clinic_id='${clinic}' and not is_shared`)
  patient = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinic}', 'Past Patient', '123') returning id`)
  as(admin, `select replace_patient_external_access('${patient}', '{${external}}'::uuid[])`)
  applyMigrationsAfter(DB, previous)
})
after(() => { if (!skip) dropDatabase(DB) })

test("yesterday's still-scheduled session cannot be moved forward, retimed or retyped", { skip }, () => {
  const past = sessionOn(day(-1), '09:00')
  for (const changes of [{ date: day(1) }, { date: clinicToday }, { time: '10:30' }, { duration_minutes: 60 }, { appointment_type_id: restricted }]) {
    assert.throws(() => update(external, intent(past, changes)), /can no longer be changed/, JSON.stringify(changes))
  }
  assert.equal(row(past.id, `date || ' ' || time || ' ' || duration_minutes || ' ' || status || ' ' || appointment_type_id`),
    `${day(-1)} 09:00:00 45 scheduled ${shared}`)
})

test('a long-past session the job never reached is refused too', { skip }, () => {
  const past = sessionOn('2026-01-05', '11:00')
  assert.throws(() => update(external, intent(past, { date: day(3) })), /can no longer be changed/)
  assert.equal(row(past.id, 'date'), '2026-01-05')
})

test("today's and future sessions can still be rescheduled and cancelled", { skip }, () => {
  const today = sessionOn(clinicToday, '12:00')
  assert.equal(update(external, intent(today, { time: '12:30' })).time.slice(0, 5), '12:30')
  const upcoming = sessionOn(day(2), '13:00')
  assert.equal(update(external, intent(upcoming, { date: day(4) })).date, day(4))
  assert.equal(update(external, intent({ ...upcoming, date: day(4) }, { status: 'cancelled' })).status, 'cancelled')
})

test('the refusal reports the same SQLSTATE as the past-cancel guard', { skip }, () => {
  const past = sessionOn(day(-1), '14:00')
  const sqlstate = (request: Record<string, unknown>) => query(DB, `
    create function pg_temp.sqlstate(request jsonb) returns text language plpgsql as $$
    begin perform public.external_update_appointment(request); return 'ok';
    exception when others then return sqlstate; end $$;
    set role authenticated; set request.jwt.claim.sub = '${external}';
    select pg_temp.sqlstate('${JSON.stringify(request)}'::jsonb)`)
  assert.equal(sqlstate(intent(past, { date: day(1) })), 'P0002')
  assert.equal(sqlstate(intent(past, { status: 'cancelled' })), 'P0002')
})
