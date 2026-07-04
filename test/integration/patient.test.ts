// Patient creation flows, mirroring the inline patient creation in the appointment form and the
// patient form (both do a direct insert into `patients`).

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query } from './db.ts'

const DB = 'carebook_it_patient'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

before(() => {
  if (hasPostgres) buildDatabase(DB)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

test('a patient with name and phone is created', { skip }, () => {
  const id = query(DB, `insert into patients (name, phone) values ('Asha', '9876543210') returning id`)
  assert.match(id, /^[0-9a-f-]{36}$/, 'should return a uuid')
})

test('phone is optional (migration 010_make_phone_optional)', { skip }, () => {
  // buildPatientInsertData converts a blank phone to null; the column must allow it.
  const id = query(DB, `insert into patients (name, phone) values ('No Phone', null) returning id`)
  assert.match(id, /^[0-9a-f-]{36}$/)
})

test('name is required', { skip }, () => {
  assert.throws(
    () => query(DB, `insert into patients (name, phone) values (null, '9876543210')`),
    /not-null|null value/i,
    'a null name should violate the not-null constraint'
  )
})

test('updated_at is bumped on update', { skip }, () => {
  const id = query(DB, `insert into patients (name, phone) values ('Bump', '1') returning id`)
  // Force an older timestamp, then update and confirm the trigger advanced it.
  query(DB, `update patients set updated_at = now() - interval '1 day' where id = '${id}'`)
  const before = query(DB, `select updated_at from patients where id = '${id}'`)
  query(DB, `update patients set notes = 'touched' where id = '${id}'`)
  const after = query(DB, `select updated_at from patients where id = '${id}'`)
  assert.ok(after > before, 'updated_at should advance on update')
})
