import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import {
  applyMigrationsAfter, buildDatabaseThrough, dropDatabase, postgresAvailable,
  query, queryAsAuthenticated, run, seedUser,
} from './db.ts'

// Migration 20261121100000: External Staff reschedule or cancel their own scheduled appointments
// through external_update_appointment; the external projection gains appointment_type_id.
const DB = 'carebook_it_external_appointment_updates'
const previous = '20261121032844_booking_fee_default_and_invited_external_staff.sql'
const skip = postgresAvailable() ? false : 'no local Postgres reachable'
const clinicToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
const day = (offset: number) => {
  const date = new Date(`${clinicToday}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}
const as = (actor: string, sql: string) => queryAsAuthenticated(DB, actor, sql)
const book = (actor: string, request: Record<string, unknown>) =>
  JSON.parse(as(actor, `select external_create_appointment('${JSON.stringify(request)}'::jsonb)`))
const update = (actor: string, request: Record<string, unknown>) =>
  JSON.parse(as(actor, `select external_update_appointment('${JSON.stringify(request)}'::jsonb)`))
const replace = (patient: string, profiles: string[]) =>
  as(admin, `select replace_patient_external_access('${patient}', '{${profiles.join(',')}}'::uuid[])`)
const row = (id: string, columns: string) => query(DB, `select ${columns} from appointments where id='${id}'`)

type Booking = { id: string; patient_id: string; appointment_type_id: string; date: string; time: string; duration_minutes: number; status: string }
/** The update request that restates a booking as it is now, with optional changes. */
const intent = (booking: Booking, changes: Record<string, unknown> = {}) => ({
  id: booking.id, appointment_type_id: booking.appointment_type_id, date: booking.date,
  time: booking.time.slice(0, 5), duration_minutes: booking.duration_minutes, status: 'scheduled', ...changes,
})

let clinic: string, otherClinic: string, admin: string, staff: string, a: string, b: string
let shared: string, restricted: string, sharedName: string, restrictedName: string

const sharedPatient = (name: string, profiles = [a, b]) => {
  const id = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinic}', '${name}', '123') returning id`)
  replace(id, profiles)
  return id
}
const bookFor = (actor: string, patient: string, overrides: Record<string, unknown> = {}): Booking =>
  book(actor, { id: randomUUID(), patient_id: patient, appointment_type_id: shared, date: day(2), time: '10:00',
    duration_minutes: 45, ...overrides })

before(() => {
  if (skip) return
  buildDatabaseThrough(DB, previous)
  clinic = query(DB, "insert into clinics (name) values ('Updates') returning id")
  otherClinic = query(DB, "insert into clinics (name) values ('Other') returning id")
  admin = seedUser(DB, 'admin', clinic)
  staff = seedUser(DB, 'staff', clinic)
  a = seedUser(DB, 'staff', clinic)
  b = seedUser(DB, 'staff', clinic)
  run(DB, `update profiles set role='external_staff' where id in ('${a}','${b}')`)
  shared = query(DB, `update appointment_types set session_rate=800 where clinic_id='${clinic}' and is_shared returning id`)
  restricted = query(DB, `update appointment_types set session_rate=1500 where clinic_id='${clinic}' and not is_shared returning id`)
  sharedName = query(DB, `select name from appointment_types where id='${shared}'`)
  restrictedName = query(DB, `select name from appointment_types where id='${restricted}'`)
  applyMigrationsAfter(DB, previous)
})
after(() => { if (!skip) dropDatabase(DB) })

test('a reschedule moves the slot, returns the safe projection with appointment_type_id and keeps the fee', { skip }, () => {
  const p = sharedPatient('Reschedule')
  const booked = bookFor(a, p)
  assert.equal(booked.appointment_type_id, shared, 'bookings also return the type id')
  run(DB, `update appointments set fee = 999 where id='${booked.id}'`) // an admin-set rate
  const moved = update(a, intent(booked, { date: day(3), time: '11:30', duration_minutes: 60 }))
  assert.deepEqual(moved, { id: booked.id, patient_id: p, patient_name: 'Reschedule', appointment_type_id: shared,
    date: day(3), time: '11:30:00', duration_minutes: 60, type: sharedName, status: 'scheduled' })
  assert.equal(row(booked.id, `fee || ':' || date || ':' || time || ':' || external_profile_id || ':' || created_by`),
    `999.00:${day(3)}:11:30:00:${a}:${a}`, 'same-type reschedule leaves the fee, assignee and creator alone')
  assert.equal(query(DB, `select amount || ':' || status from appointment_charges where appointment_id='${booked.id}'`), '999.00:pending')
  const listed = JSON.parse(as(a, `select external_workspace('${day(0)}', '${day(10)}')`)).appointments
  assert.deepEqual(listed, [moved], 'the workspace projection carries the same fields')
  // A same-day move is allowed; the clinic date is the boundary.
  assert.equal(update(a, intent(moved, { date: day(0) })).date, day(0))
})

test("a type change reprices from the patient's history for the new type, else its rate", { skip }, () => {
  const p = sharedPatient('Reprice')
  as(admin, `insert into appointments (patient_id, date, time, appointment_type_id, status, fee)
    values ('${p}', '${day(-10)}', '09:00', '${restricted}', 'completed', 1700)`)
  const booked = bookFor(a, p)
  assert.equal(row(booked.id, 'fee'), '800.00')
  const switched = update(a, intent(booked, { appointment_type_id: restricted }))
  assert.equal(switched.appointment_type_id, restricted)
  assert.equal(switched.type, restrictedName)
  assert.equal(switched.fee, undefined, 'External Staff never see the fee')
  assert.equal(row(booked.id, 'fee'), '1700.00')
  assert.equal(query(DB, `select amount from appointment_charges where appointment_id='${booked.id}'`), '1700.00')
  const fresh = sharedPatient('Reprice New')
  const other = bookFor(a, fresh, { appointment_type_id: restricted })
  run(DB, `update appointments set fee = 50 where id='${other.id}'`)
  update(a, intent(other, { appointment_type_id: shared }))
  assert.equal(row(other.id, 'fee'), '800.00', 'no history for the new type: the type rate')
})

test('a cancellation voids the pending charge and the appointment then cannot be changed', { skip }, () => {
  const p = sharedPatient('Cancel')
  const booked = bookFor(a, p)
  const cancelled = update(a, intent(booked, { status: 'cancelled' }))
  assert.deepEqual(cancelled, { ...booked, status: 'cancelled' })
  assert.equal(row(booked.id, `status || ':' || payment_status || ':' || fee`), 'cancelled:unpaid:800.00')
  assert.equal(query(DB, `select amount || ':' || status from appointment_charges where appointment_id='${booked.id}'`), '800.00:voided')
  assert.equal(query(DB, `select count(*) from payment_applications where charge_id in
    (select id from appointment_charges where appointment_id='${booked.id}') and status='active'`), '0')
  for (const changes of [{ status: 'cancelled' }, { date: day(3) }, {}]) {
    assert.throws(() => update(a, intent(cancelled, changes)), /can no longer be changed/)
  }
})

test('a cancellation that also changes the slot, duration or type is refused', { skip }, () => {
  const p = sharedPatient('Cancel Strict')
  const booked = bookFor(a, p)
  for (const changes of [{ date: day(3) }, { time: '10:30' }, { duration_minutes: 30 }, { appointment_type_id: restricted }]) {
    assert.throws(() => update(a, intent(booked, { ...changes, status: 'cancelled' })), /Invalid booking request/)
  }
  assert.equal(row(booked.id, `status || ':' || date || ':' || duration_minutes`), `scheduled:${day(2)}:45`)
  // Seconds are optional in the time, as for booking.
  assert.equal(update(a, intent(booked, { status: 'cancelled', time: '10:00:00' })).status, 'cancelled')
})

test("another external's, an internal, another clinic's or an unshared patient's appointment is denied", { skip }, () => {
  const p = sharedPatient('Ownership')
  const theirs = bookFor(b, p)
  assert.throws(() => update(a, intent(theirs, { date: day(3) })), /Access denied/)
  assert.throws(() => update(a, intent(theirs, { status: 'cancelled' })), /Access denied/)
  const internalId = as(admin, `insert into appointments (patient_id, date, time, appointment_type_id)
    values ('${p}', '${day(2)}', '15:00', '${shared}') returning id`)
  const internal = { id: internalId, appointment_type_id: shared, date: day(2), time: '15:00', duration_minutes: 60, status: 'scheduled' }
  assert.throws(() => update(a, internal), /Access denied/)
  assert.throws(() => update(a, { ...internal, id: randomUUID() }), /Access denied/)
  const otherPatient = query(DB, `insert into patients (clinic_id, name, phone) values ('${otherClinic}', 'Elsewhere', '1') returning id`)
  const elsewhere = query(DB, `insert into appointments (patient_id, date, time, type)
    values ('${otherPatient}', '${day(2)}', '10:00', 'clinic') returning id`)
  assert.throws(() => update(a, { ...internal, id: elsewhere }), /Access denied/)
  assert.equal(row(theirs.id, 'date'), day(2))
  assert.equal(row(internalId, 'status'), 'scheduled')

  // Admin-assigned appointments are the assignee's own to change.
  const assignedId = as(admin, `insert into appointments (patient_id, date, time, appointment_type_id, external_profile_id)
    values ('${p}', '${day(2)}', '16:00', '${shared}', '${a}') returning id`)
  const assigned = { id: assignedId, appointment_type_id: shared, date: day(2), time: '16:00', duration_minutes: 60, status: 'scheduled' }
  assert.equal(update(a, { ...assigned, time: '16:30' }).time, '16:30:00')

  // Revoking the patient grant closes the write path even for their own appointment.
  const mine = bookFor(a, p, { time: '08:00' })
  replace(p, [b])
  assert.throws(() => update(a, intent(mine, { date: day(3) })), /Access denied/)
  assert.throws(() => update(a, intent(mine, { status: 'cancelled' })), /Access denied/)
  assert.equal(row(mine.id, `status || ':' || date`), `scheduled:${day(2)}`)
  replace(p, [a, b])
})

test('completed and cancelled appointments can no longer be changed', { skip }, () => {
  const p = sharedPatient('Final')
  for (const status of ['completed', 'cancelled']) {
    const booked = bookFor(a, p, { time: status === 'completed' ? '07:00' : '07:30' })
    run(DB, `update appointments set status='${status}' where id='${booked.id}'`)
    assert.throws(() => update(a, intent(booked, { date: day(3) })), /can no longer be changed/)
    assert.throws(() => update(a, intent(booked, { status: 'cancelled' })), /can no longer be changed/)
    assert.equal(row(booked.id, `status || ':' || date`), `${status}:${day(2)}`)
  }
})

test('a reschedule cannot be backdated into a session the auto-complete job would bill', { skip }, () => {
  const p = sharedPatient('Backdate')
  const booked = bookFor(a, p)
  for (const date of [day(-1), '2002-02-02']) {
    assert.throws(() => update(a, intent(booked, { date })), /Invalid booking request/)
  }
  assert.equal(row(booked.id, 'date'), day(2))
})

test('a reschedule onto another live booking of yours for the patient is refused; a cancelled one does not block', { skip }, () => {
  const p = sharedPatient('Duplicate')
  const first = bookFor(a, p, { time: '13:00' })
  const second = bookFor(a, p, { time: '14:00' })
  bookFor(b, p, { time: '15:00' }) // another assignee's booking never blocks this one
  assert.throws(() => update(a, intent(second, { time: '13:00' })), /already have an appointment for this patient at that time/)
  assert.equal(row(second.id, 'time'), '14:00:00')
  assert.equal(update(a, intent(second, { time: '15:00' })).time, '15:00:00')
  // Restating the current slot is not a clash with itself.
  assert.equal(update(a, intent(first, { duration_minutes: 30 })).duration_minutes, 30)
  update(a, intent(first, { status: 'cancelled', duration_minutes: 30 }))
  assert.equal(update(a, intent(second, { time: '13:00' })).time, '13:00:00')
})

test('only eligible External Staff can call the update; malformed requests are refused', { skip }, () => {
  const p = sharedPatient('Callers')
  const booked = bookFor(a, p)
  for (const actor of [admin, staff]) {
    assert.throws(() => update(actor, intent(booked, { date: day(3) })), /Access denied/)
  }
  assert.throws(() => query(DB, `set role anon; select external_update_appointment('${JSON.stringify(intent(booked))}'::jsonb)`),
    /permission denied/)
  run(DB, `update profiles set status='blocked' where id='${b}'`)
  assert.throws(() => update(b, intent(booked)), /Access denied/)
  run(DB, `update profiles set status='active' where id='${b}'`)

  const missing: Record<string, unknown> = intent(booked)
  delete missing.status
  for (const invalid of [missing, { ...intent(booked), fee: 1 }, { ...intent(booked), patient_id: p },
    { ...intent(booked), notes: 'x' }, intent(booked, { status: 'completed' }), intent(booked, { duration_minutes: 0 }),
    intent(booked, { duration_minutes: 1441 }), intent(booked, { duration_minutes: '45' }), intent(booked, { time: '24:00' }),
    intent(booked, { date: '2026-02-30' }), intent(booked, { id: 'invalid' }), intent(booked, { appointment_type_id: randomUUID() }),
    intent(booked, { appointment_type_id: query(DB, `select id from appointment_types where clinic_id='${otherClinic}' limit 1`) })]) {
    assert.throws(() => update(a, invalid), /Invalid booking request/)
  }
  assert.equal(row(booked.id, `status || ':' || date || ':' || fee`), `scheduled:${day(2)}:800.00`)
})

test('each refusal carries the SQLSTATE the server action maps to a message', { skip }, () => {
  const p = sharedPatient('Codes')
  const first = bookFor(a, p, { time: '17:00' })
  const second = bookFor(a, p, { time: '18:00' })
  const done = bookFor(a, p, { time: '19:00' })
  run(DB, `update appointments set status='completed' where id='${done.id}'`)
  const sqlstate = (actor: string, request: Record<string, unknown>) => query(DB, `
    create function pg_temp.sqlstate(request jsonb) returns text language plpgsql as $$
    begin perform public.external_update_appointment(request); return 'ok';
    exception when others then return sqlstate; end $$;
    set role authenticated; set request.jwt.claim.sub = '${actor}';
    select pg_temp.sqlstate('${JSON.stringify(request)}'::jsonb)`)
  assert.equal(sqlstate(b, intent(first)), '42501')
  assert.equal(sqlstate(admin, intent(first)), '42501')
  assert.equal(sqlstate(a, intent(done)), 'P0002')
  assert.equal(sqlstate(a, intent(second, { time: '17:00' })), '23P01')
  assert.equal(sqlstate(a, intent(second, { date: day(-1) })), '22023')
  assert.equal(sqlstate(a, intent(second, { status: 'cancelled', time: '17:30' })), '22023')
  assert.equal(sqlstate(a, intent(second, { time: '18:30' })), 'ok')
})

test('a past-dated session still awaiting the nightly job cannot be cancelled to dodge its charge', { skip }, () => {
  const p = sharedPatient('Past Session')
  const booked = bookFor(a, p)
  // The nightly job completes yesterday's sessions; until it runs, the row is still 'scheduled'.
  run(DB, `update appointments set date = '${day(-1)}' where id='${booked.id}'`)
  assert.throws(() => update(a, intent({ ...booked, date: day(-1) }, { status: 'cancelled' })), /can no longer be changed/)
  assert.equal(row(booked.id, 'status'), 'scheduled')
})

test('a cancelled slot can be booked again', { skip }, () => {
  const p = sharedPatient('Rebook')
  const booked = bookFor(a, p, { time: '16:00' })
  update(a, intent(booked, { status: 'cancelled' }))
  const again = bookFor(a, p, { time: '16:00' })
  assert.notEqual(again.id, booked.id)
  assert.equal(row(again.id, 'status'), 'scheduled')
  assert.throws(() => bookFor(a, p, { time: '16:00' }), /already have an appointment/, 'a live booking still blocks the slot')
})
