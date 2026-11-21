import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { applyMigrationsAfter, buildDatabaseThrough, dropDatabase, postgresAvailable, query, queryAsAuthenticated, run, seedUser } from './db.ts'

// Migration 20261121110000: middleware reads the caller's role by auth.uid() so the read can run
// alongside the session check. It must return exactly what the direct profiles select returned.
const DB = 'carebook_it_current_profile_role'
const previous = '20261121100000_external_appointment_updates.sql'
const skip = postgresAvailable() ? false : 'no local Postgres reachable'
const role = (actor: string) => queryAsAuthenticated(DB, actor, `select coalesce(current_profile_role(), 'null')`)
const direct = (actor: string) =>
  queryAsAuthenticated(DB, actor, `select coalesce((select role from profiles where id = '${actor}'), 'null')`)

let clinic: string, admin: string, staff: string, external: string, blocked: string

before(() => {
  if (skip) return
  buildDatabaseThrough(DB, previous)
  clinic = query(DB, "insert into clinics (name) values ('Roles') returning id")
  admin = seedUser(DB, 'admin', clinic)
  staff = seedUser(DB, 'staff', clinic)
  external = seedUser(DB, 'staff', clinic)
  blocked = seedUser(DB, 'staff', clinic)
  run(DB, `update profiles set role='external_staff' where id='${external}';
    update profiles set status='blocked' where id='${blocked}'`)
  applyMigrationsAfter(DB, previous)
})
after(() => { if (!skip) dropDatabase(DB) })

test("returns the caller's own role, matching the direct profiles read for every account state", { skip }, () => {
  assert.equal(role(admin), 'admin')
  assert.equal(role(staff), 'staff')
  assert.equal(role(external), 'external_staff')
  for (const actor of [admin, staff, external, blocked]) assert.equal(role(actor), direct(actor))
  run(DB, `update clinics set status='inactive' where id='${clinic}'`)
  for (const actor of [admin, staff, external]) assert.equal(role(actor), direct(actor), 'inactive clinic reads the same as before')
  run(DB, `update clinics set status='active' where id='${clinic}'`)
})

test('anonymous callers cannot execute it', { skip }, () => {
  assert.throws(() => query(DB, 'set role anon; select current_profile_role()'), /permission denied/)
})
