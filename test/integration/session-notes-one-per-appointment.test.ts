import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  applyMigrationsAfter, buildDatabaseThrough, dropDatabase, postgresAvailable,
  query, queryAsAuthenticated, run, seedUser,
} from './db.ts'

// Migration 20261124131000 (G-4): one session note per appointment. Duplicates left by the old
// insert-on-every-save are resolved by keeping the newest note and moving the older ones to an
// archive table, never by dropping them.
const DB = 'carebook_it_session_notes_unique'
const previous = '20261124130000_external_past_reschedule_guard.sql'
const skip = postgresAvailable() ? false : 'no local Postgres reachable'

let admin = '', duplicated = '', single = '', newest = '', only = ''
const oldest: string[] = []

function appointment(patient: string, time: string) {
  return query(DB, `insert into appointments (patient_id, date, time, type, status, fee)
    values ('${patient}', current_date - 3, '${time}', 'clinic', 'completed', 500) returning id`)
}

function note(appointmentId: string, subjective: string, age: string) {
  return query(DB, `insert into session_notes (appointment_id, subjective, created_at)
    values ('${appointmentId}', '${subjective}', now() - interval '${age}') returning id`)
}

before(() => {
  if (skip) return
  buildDatabaseThrough(DB, previous)
  const clinic = query(DB, "insert into clinics (name) values ('Notes Clinic') returning id")
  admin = seedUser(DB, 'admin', clinic)
  const patient = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinic}', 'Notes Patient', '123') returning id`)
  duplicated = appointment(patient, '09:00')
  single = appointment(patient, '10:00')
  oldest.push(note(duplicated, 'first save', '3 hours'), note(duplicated, 'lost-reply resave', '2 hours'))
  newest = note(duplicated, 'latest save', '1 hour')
  only = note(single, 'only note', '1 hour')
  applyMigrationsAfter(DB, previous)
})
after(() => { if (!skip) dropDatabase(DB) })

test('the newest note of a duplicated appointment is kept untouched; older ones are archived, not lost', { skip }, () => {
  assert.equal(query(DB, `select string_agg(id::text || ':' || subjective, ',') from session_notes where appointment_id = '${duplicated}'`),
    `${newest}:latest save`)
  assert.equal(query(DB, `select string_agg(id::text || ':' || subjective || ':' || kept_note_id, ',' order by created_at)
    from private.session_notes_duplicates_archive where appointment_id = '${duplicated}'`),
  `${oldest[0]}:first save:${newest},${oldest[1]}:lost-reply resave:${newest}`)
  assert.equal(query(DB, `select subjective from session_notes where id = '${only}'`), 'only note')
  assert.equal(query(DB, `select count(*) from private.session_notes_duplicates_archive where appointment_id = '${single}'`), '0')
})

test('a second note for an appointment is refused', { skip }, () => {
  assert.throws(() => run(DB, `insert into session_notes (appointment_id, subjective) values ('${single}', 'again')`), /session_notes_one_per_appointment/)
  assert.equal(query(DB, `select count(*) from pg_indexes where schemaname = 'public' and indexname = 'idx_session_notes_appointment_id'`), '0')
})

test('the archive is not reachable through the API roles and follows its appointment', { skip }, () => {
  assert.equal(query(DB, `select has_table_privilege('authenticated', 'private.session_notes_duplicates_archive', 'select')`), 'f')
  assert.equal(query(DB, `select has_table_privilege('anon', 'private.session_notes_duplicates_archive', 'select')`), 'f')
  assert.throws(() => queryAsAuthenticated(DB, admin, 'select count(*) from private.session_notes_duplicates_archive'), /permission denied/)
  run(DB, `delete from appointments where id = '${duplicated}'`)
  assert.equal(query(DB, `select count(*) from private.session_notes_duplicates_archive where appointment_id = '${duplicated}'`), '0')
})
