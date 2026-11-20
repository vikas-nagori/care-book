import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { after, before, test } from 'node:test'
import {
  applyMigrationsAfter, buildDatabaseThrough, dropDatabase, postgresAvailable,
  query, queryAsAuthenticated, run, seedUser,
} from './db.ts'

const DB = 'carebook_it_external_access'
const previous = '20261120192036_patient_delete_admin_only.sql'
const skip = postgresAvailable() ? false : 'no local Postgres reachable'
// Bookings are checked against the clinic's current date, so fixtures are relative to it.
const clinicToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
const day = (offset: number) => {
  const date = new Date(`${clinicToday}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}
const BOOKING_DAY = day(2), LATER_DAY = day(4), EMPTY_DAY = day(5)
const as = (actor: string, sql: string) => queryAsAuthenticated(DB, actor, sql)
const workspace = (actor: string, from = day(-10), to = day(30)) =>
  JSON.parse(as(actor, `select external_workspace('${from}', '${to}')`))
const replace = (actor: string, patient: string, profiles: string[]) =>
  as(actor, `select replace_patient_external_access('${patient}', '{${profiles.join(',')}}'::uuid[])`)
const book = (actor: string, request: Record<string, unknown>) =>
  JSON.parse(as(actor, `select external_create_appointment('${JSON.stringify(request)}'::jsonb)`))
const patient = (clinic: string, name: string) =>
  query(DB, `insert into patients (clinic_id, name, phone, medical_history, notes)
    values ('${clinic}', '${name}', '123', 'private history', 'private note') returning id`)
let clinic: string, otherClinic: string, admin: string, staff: string, a: string, b: string,
  outsider: string, otherAdmin: string, type: string, otherType: string,
  p: string, other: string, temporary: string, oldBooking: string
const request = () => ({ id: randomUUID(), patient_id: p, appointment_type_id: type,
  date: BOOKING_DAY, time: '10:00', duration_minutes: 45 })

before(() => {
  if (skip) return
  buildDatabaseThrough(DB, previous)
  clinic = query(DB, "insert into clinics (name) values ('Coordination') returning id")
  otherClinic = query(DB, "insert into clinics (name) values ('Other') returning id")
  admin = seedUser(DB, 'admin', clinic)
  staff = seedUser(DB, 'staff', clinic)
  otherAdmin = seedUser(DB, 'admin', otherClinic)
  p = patient(clinic, 'Shared Patient')
  other = patient(otherClinic, 'Other Patient')
  temporary = as(admin, "insert into external_staff (name, phone) values ('Temporary', '123') returning id")
  oldBooking = as(admin, `insert into appointments (patient_id,date,time,type,external_staff_id)
    values ('${p}', '${BOOKING_DAY}', '10:00', 'home_visit', '${temporary}') returning id`)
  applyMigrationsAfter(DB, previous)
  type = query(DB, `update appointment_types set session_rate=750 where clinic_id='${clinic}' and is_shared returning id`)
  otherType = query(DB, `select id from appointment_types where clinic_id='${otherClinic}' and is_shared`)
  a = seedUser(DB, 'staff', clinic)
  b = seedUser(DB, 'staff', clinic)
  outsider = seedUser(DB, 'staff', otherClinic)
  run(DB, `update profiles set role='external_staff' where id in ('${a}','${b}','${outsider}')`)
})
after(() => { if (!skip) dropDatabase(DB) })

test('existing Temporary Staff, bookings and internal profiles survive upgrade; external profiles start empty', { skip }, () => {
  assert.equal(query(DB, `select external_staff_id from appointments where id='${oldBooking}'`), temporary)
  assert.equal(query(DB, `select role from profiles where id='${staff}'`), 'staff')
  const empty = workspace(a)
  assert.deepEqual(empty.patients, [])
  assert.deepEqual(empty.appointments, [])
  assert.equal(empty.appointment_types.length, 2)
  assert.deepEqual(Object.keys(empty.appointment_types[0]).sort(), ['id', 'name'])
  assert.throws(() => book(a, request()), /Access denied/)
  assert.throws(() => workspace(staff), /Access denied/)
  assert.throws(() => workspace(admin), /Access denied/)
  assert.throws(() => workspace(a, '2026-01-01', '2027-01-02'), /Invalid date range/)
})

test('atomic grants validate clinic, active role and invite status; only clinic admins can replace or see them', { skip }, () => {
  const p = patient(clinic, 'Shared Patient')
  replace(admin, p, [a, b, a])
  assert.deepEqual(workspace(a).patients, [{ id: p, name: 'Shared Patient', phone: '123', dob: null, gender: null, address: null, email: null }])
  assert.deepEqual(workspace(b).patients, workspace(a).patients)
  assert.deepEqual(workspace(outsider).patients, [])
  const additional = patient(clinic, 'Additional Patient')
  replace(admin, additional, [a])
  assert.deepEqual(workspace(a).patients.map((row: { id: string }) => row.id), [additional, p])
  replace(admin, additional, [])
  for (const actor of [staff, a, otherAdmin]) assert.throws(() => replace(actor, p, []))
  assert.throws(() => replace(admin, other, [a]))
  const pending = seedUser(DB, 'staff', clinic)
  run(DB, `update profiles set role='external_staff' where id='${pending}';
    insert into user_invites (clinic_id, email, role, invited_by, auth_user_id)
    select clinic_id, email, role, '${admin}', id from profiles where id='${pending}'`)
  const blocked = seedUser(DB, 'staff', clinic)
  run(DB, `update profiles set role='external_staff',status='blocked' where id='${blocked}'`)
  const deleted = seedUser(DB, 'staff', clinic)
  run(DB, `set request.jwt.claim.role = 'service_role'; update profiles set role='external_staff',
    status='deleted', deleted_by='${admin}', deleted_at=now(), deletion_reason='test' where id='${deleted}'`)
  for (const invalid of [outsider, staff, pending, blocked, deleted, randomUUID()]) {
    assert.throws(() => replace(admin, p, [a, invalid]))
    assert.equal(as(admin, 'select count(*) from patient_external_access'), '2')
  }
  for (const actor of [blocked, pending, deleted]) assert.throws(() => workspace(actor), /Access denied/)
  for (const actor of [a, staff, otherAdmin]) assert.equal(as(actor, 'select count(*) from patient_external_access'), '0')
  assert.throws(() => as(admin, 'delete from patient_external_access'), /permission denied/)
  replace(admin, p, [])
})

test('shared-type external bookings expose safe fields and are private to admin and current assignee', { skip }, () => {
  replace(admin, p, [a, b])
  const input = request()
  const first = book(a, input) // same slot as the hidden Temporary Staff booking
  assert.deepEqual(first, { id: first.id, patient_id: p, patient_name: 'Shared Patient',
    date: BOOKING_DAY, time: '10:00:00', duration_minutes: 45, type: 'Clinic', status: 'scheduled' })
  assert.deepEqual(book(a, input), first)
  assert.throws(() => book(a, { ...input, duration_minutes: 30 }), /Invalid booking request/)
  assert.throws(() => book(a, request()), /already have an appointment/)
  assert.deepEqual(workspace(b).appointments, [])
  const second = book(b, { ...input }) // another actor can use the same UUID and same slot
  assert.notEqual(first.id, second.id)
  assert.equal(as(admin, `select fee || ':' || external_profile_id || ':' || created_by from appointments where id='${first.id}'`), `750.00:${a}:${a}`)
  assert.equal(as(admin, `select amount from appointment_charges where appointment_id='${first.id}'`), '750.00')
  const adminBooked = as(admin, `insert into appointments (patient_id,appointment_type_id,date,time,external_profile_id)
    values ('${p}','${type}','${LATER_DAY}','14:00','${a}') returning id`)
  as(admin, `insert into session_notes (appointment_id,subjective) values ('${adminBooked}','private')`)
  for (const actor of [staff, a, b]) {
    assert.equal(as(actor, `select count(*) from appointments where id in ('${adminBooked}','${first.id}','${second.id}')`), '0')
    assert.equal(as(actor, `select count(*) from session_notes where appointment_id='${adminBooked}'`), '0')
  }
  assert.deepEqual(workspace(a).appointments.map((row: { id: string }) => row.id), [first.id, adminBooked])
  assert.deepEqual(workspace(a, EMPTY_DAY, EMPTY_DAY).appointments, [])
  for (const actor of [staff, a]) {
    assert.equal(as(actor, `update appointments set status='cancelled' where id='${adminBooked}' returning id`), '')
    assert.equal(as(actor, `delete from session_notes where appointment_id='${adminBooked}' returning id`), '')
    assert.equal(as(actor, `select can_access_appointment('${clinic}',true,'${admin}',null,'${a}')`), 'f')
  }
  assert.equal(as(admin, `select can_access_appointment('${clinic}',true,'${admin}',null,'${a}')`), 't')
  assert.throws(() => as(a, `insert into appointments (patient_id,type,date,time,external_profile_id)
    values ('${p}','clinic','${EMPTY_DAY}','09:00','${a}')`), /row-level security/)
  assert.throws(() => as(staff, `insert into appointments (patient_id,type,date,time,external_profile_id)
    values ('${p}','clinic','${EMPTY_DAY}','09:00','${a}')`))
  assert.throws(() => as(admin, `update appointments set external_profile_id='${outsider}' where id='${first.id}'`))
  as(admin, `update appointments set external_profile_id='${b}' where id='${first.id}'`)
  assert.throws(() => book(a, input), /Invalid booking request/)
  assert.deepEqual(workspace(a).appointments.map((row: { id: string }) => row.id), [adminBooked])
  replace(admin, p, [b])
  assert.deepEqual(workspace(a).patients, [])
  assert.deepEqual(workspace(a).appointments, [])
  assert.throws(() => book(a, input), /Access denied/)
  assert.equal(as(admin, `select count(*) from appointments where id='${adminBooked}'`), '1')
  replace(admin, p, [])
  assert.deepEqual(workspace(b).appointments, [])
  assert.equal(query(DB, `select count(*) from private.patient_external_access_events where patient_id='${p}'`), '4')
})

test('external roles cannot retrieve tenant, clinical or financial data or provide protected booking fields', { skip }, () => {
  replace(admin, p, [a])
  as(admin, `insert into doctors (clinic_id,name) values ('${clinic}','Referring doctor');
    insert into treatment_plans (clinic_id, patient_id, diagnosis, start_date)
    values ('${clinic}','${p}','Private diagnosis',current_date);
    insert into reminders (clinic_id,created_by,title,date,patient_id)
    values ('${clinic}','${admin}','Private follow-up',current_date,'${p}')`)
  // Rows retained from a former internal login must disappear after a role change.
  run(DB, `insert into mcp_oauth_clients (client_id,redirect_uris) values ('test-client',array['https://example.test/cb']);
    with tracked as (insert into mcp_access_grants (user_id,clinic_id,client_id,scopes,resource,access_token_hash,access_expires_at)
      values ('${a}','${clinic}','test-client',array['read'],'https://example.test/api/mcp','example',now()) returning id)
    insert into mcp_tool_invocations (grant_id,user_id,clinic_id,tool_name,request_digest,status,result_json)
    select id,'${a}','${clinic}','historical','test','ok','{"memo":"private"}'::jsonb from tracked`)
  for (const table of [
    'patients', 'appointments', 'clinics', 'treatment_plans', 'session_notes', 'doctors', 'global_settings',
    'reminders', 'payments', 'packages', 'appointment_charges', 'billing_events', 'patient_billing_balances_v2',
    'package_billing_balances_v2', 'external_staff', 'user_invites', 'patient_external_access', 'mcp_access_grants',
    'mcp_tool_invocations', 'mcp_oauth_clients', 'appointment_types', 'package_templates',
    'appointment_charge_adjustments', 'appointment_payments', 'refunds', 'refund_reversals', 'payment_applications',
    'package_session_allocations', 'mcp_authorization_codes', 'mcp_resolution_tokens', 'clinic_onboarding_requests',
  ]) {
    const canRead = query(DB, `select has_table_privilege('authenticated','${table}','select')`) === 't'
    if (canRead) assert.equal(as(a, `select count(*) from ${table}`), '0', table)
    else assert.throws(() => as(a, `select * from ${table}`), /permission denied/)
  }
  assert.throws(() => as(a, 'select * from private.external_booking_requests'), /permission denied/)
  assert.throws(() => as(a, 'select * from private.patient_external_access_events'), /permission denied/)
  assert.throws(() => query(DB, "set role anon; select public.external_workspace(current_date,current_date)"), /permission denied/)
  assert.equal(as(a, 'select id from profiles'), a)
  assert.equal(as(a, 'select count(*) from patients join appointments on appointments.patient_id=patients.id'), '0')
  assert.equal(JSON.parse(as(a, `select preview_billing_allocation_v2('${p}')`)).success, false)
  for (const invalid of [{ fee: 1 }, { notes: 'clinical' }, { external_profile_id: b }, { created_by: b },
    { duration_minutes: 0 }, { duration_minutes: 1441 }, { duration_minutes: '45' }, { date: '2026-02-30' },
    { time: '24:00' }, { id: 'invalid' }, { appointment_type_id: otherType }]) {
    assert.throws(() => book(a, { ...request(), ...invalid }), /Invalid booking request/)
  }
  assert.throws(() => book(a, { ...request(), patient_id: other }), /Access denied/)
  run(DB, `update clinics set status='inactive' where id='${clinic}'`)
  assert.throws(() => workspace(a), /Access denied/)
  assert.throws(() => book(a, request()), /Access denied/)
  assert.throws(() => replace(admin, p, []), /Access denied/)
  run(DB, `update clinics set status='active' where id='${clinic}'`)
})

test('booking rechecks a concurrent revocation after acquiring the patient lock', { skip }, async () => {
  replace(admin, p, [a])
  const transaction = spawn('psql', ['-XqAt', '-v', 'ON_ERROR_STOP=1', '-d', DB], { stdio: 'pipe' })
  const transactionExit = once(transaction, 'exit')
  try {
    const ready = once(transaction.stdout, 'data')
    transaction.stdin.write(`begin;
      set local role authenticated;
      set local request.jwt.claim.sub = '${admin}';
      select replace_patient_external_access('${p}', '{}');
      \\echo ready
`)
    await ready
    const attempt = promisify(execFile)('psql', ['-XqAt', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-c',
      `set application_name='external_booking_wait_test';
       set role authenticated; set request.jwt.claim.sub='${a}';
       select external_create_appointment('${JSON.stringify(request())}')`])
    const denied = assert.rejects(attempt, /Access denied/)
    let waiting = false
    for (let tries = 0; tries < 100 && !waiting; tries++) {
      waiting = query(DB, `select exists(select 1 from pg_stat_activity
        where datname=current_database() and application_name='external_booking_wait_test'
        and wait_event_type='Lock' and wait_event='advisory')`) === 't'
      if (!waiting) await delay(20)
    }
    assert.equal(waiting, true, 'the second database session waited for grant replacement')
    transaction.stdin.end('commit;\n')
    await denied
  } finally {
    if (!transaction.stdin.writableEnded) transaction.stdin.end('rollback;\n')
    await transactionExit
  }
})

test('concurrent retries create one booking; a receipt survives deletion', { skip }, async () => {
  replace(admin, p, [a])
  const input = { ...request(), time: '18:00' }
  const sql = `set role authenticated; set request.jwt.claim.sub='${a}';
    select external_create_appointment('${JSON.stringify(input)}')`
  const results = await Promise.all([1, 2].map(() =>
    promisify(execFile)('psql', ['-XqAt', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-c', sql])))
  const booking = JSON.parse(results[0].stdout)
  assert.deepEqual(JSON.parse(results[1].stdout), booking)
  assert.equal(as(admin, `select count(*) from appointments where external_profile_id='${a}' and time='18:00'`), '1')
  as(admin, `delete from appointments where id='${booking.id}'`)
  assert.throws(() => book(a, input), /Invalid booking request/)
})

test('external bookings cannot be backdated into sessions the auto-complete job would bill', { skip }, () => {
  replace(admin, p, [a])
  for (const date of [day(-1), '2002-02-02']) {
    assert.throws(() => book(a, { ...request(), date, time: '07:00' }), /Invalid booking request/)
    assert.equal(as(admin, `select count(*) from appointments where date='${date}'`), '0')
  }
  const sameDay = book(a, { ...request(), date: day(0), time: '07:00' })
  assert.equal(sameDay.date, day(0))
  assert.equal(sameDay.status, 'scheduled')
  replace(admin, p, [])
})

test('sharing and external assignment count as retained history, so those users are soft-deleted', { skip }, () => {
  const history = (id: string) => query(DB, `select private.user_has_retained_history('${id}')`)
  const grantor = seedUser(DB, 'admin', clinic)
  const recipient = seedUser(DB, 'staff', clinic)
  run(DB, `update profiles set role='external_staff' where id='${recipient}'`)
  assert.equal(history(grantor), 'f')
  assert.equal(history(recipient), 'f')
  replace(grantor, p, [recipient])
  assert.equal(history(grantor), 't', 'granted_by references the admin who shared the patient')
  assert.equal(history(recipient), 't', 'the access audit trail references the recipient')
  replace(grantor, p, [])
})
