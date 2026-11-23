import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { applyMigrationsAfter, buildDatabaseThrough, dropDatabase, postgresAvailable, query, queryAsAuthenticated, run, seedUser } from './db.ts'

// Migration 20261123200000: mobile number + password sign-in. A login may now have no email, the
// new-user trigger records its mobile number, and clinic admins can no longer write user_invites
// directly (the temp-password and revoke actions trusted its auth_user_id).
const DB = 'carebook_it_mobile_number_login'
const previous = '20261121110000_current_profile_role.sql'
const skip = postgresAvailable() ? false : 'no local Postgres reachable'

let clinic: string, otherClinic: string, admin: string, victim: string, invite: string

before(() => {
  if (skip) return
  buildDatabaseThrough(DB, previous)
  clinic = query(DB, "insert into clinics (name) values ('Mobile A') returning id")
  otherClinic = query(DB, "insert into clinics (name) values ('Mobile B') returning id")
  admin = seedUser(DB, 'admin', clinic)
  victim = seedUser(DB, 'admin', otherClinic)
  // An email-only account and its invite from before the migration must survive it unchanged.
  invite = query(DB, `insert into user_invites (clinic_id, email, role, status, invited_by, mobile_number)
    values ('${clinic}', 'legacy@test.local', 'staff', 'pending', '${admin}', '9876543210') returning id`)
  applyMigrationsAfter(DB, previous)
})
after(() => { if (!skip) dropDatabase(DB) })

test('a login with only a mobile number gets a profile carrying that number', { skip }, () => {
  const id = query(DB, "insert into auth.users (phone) values ('9511219264') returning id")
  assert.equal(query(DB, `select coalesce(email, 'null') || '|' || mobile_number || '|' || role from profiles where id = '${id}'`), 'null|9511219264|staff')
})

test('a phone that is not a bare 10-digit mobile is not copied onto the profile', { skip }, () => {
  const id = query(DB, "insert into auth.users (email, phone) values ('intl@test.local', '919511219265') returning id")
  assert.equal(query(DB, `select coalesce(mobile_number, 'null') from profiles where id = '${id}'`), 'null')
})

test('the same mobile number cannot belong to two logins', { skip }, () => {
  query(DB, "insert into auth.users (phone) values ('9000000001') returning id")
  assert.throws(() => query(DB, "insert into auth.users (phone) values ('9000000001') returning id"), /duplicate key/)
})

test('invites need an email or a mobile number, and one live invite per number', { skip }, () => {
  assert.throws(
    () => run(DB, `insert into user_invites (clinic_id, role, status, invited_by) values ('${clinic}', 'staff', 'pending', '${admin}')`),
    /user_invites_contact_present/
  )
  run(DB, `insert into user_invites (clinic_id, role, status, invited_by, mobile_number) values ('${clinic}', 'staff', 'pending', '${admin}', '9123456780')`)
  assert.throws(
    () => run(DB, `insert into user_invites (clinic_id, role, status, invited_by, mobile_number) values ('${clinic}', 'staff', 'pending', '${admin}', '9123456780')`),
    /user_invites_live_mobile_unique/
  )
  run(DB, `insert into user_invites (clinic_id, role, status, invited_by, mobile_number) values ('${clinic}', 'staff', 'revoked', '${admin}', '9123456780')`)
})

test('pre-existing email invites are untouched', { skip }, () => {
  assert.equal(query(DB, `select email || '|' || status from user_invites where id = '${invite}'`), 'legacy@test.local|pending')
})

test('a clinic admin can read but no longer write their invites', { skip }, () => {
  assert.equal(queryAsAuthenticated(DB, admin, `select count(*) from user_invites where id = '${invite}'`), '1')
  assert.throws(
    () => queryAsAuthenticated(DB, admin, `update user_invites set auth_user_id = '${victim}' where id = '${invite}'`),
    /permission denied/
  )
  assert.throws(
    () => queryAsAuthenticated(DB, admin, `insert into user_invites (clinic_id, email, role, status, invited_by, auth_user_id) values ('${clinic}', 'x@test.local', 'staff', 'revoked', '${admin}', '${victim}')`),
    /permission denied/
  )
  assert.equal(query(DB, `select coalesce(auth_user_id::text, 'null') from user_invites where id = '${invite}'`), 'null')
})
