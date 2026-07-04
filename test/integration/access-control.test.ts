// Non-admin (staff) authorization enforced at the database layer: the billing RPCs reject staff,
// and can_access_appointment() — the predicate behind the appointments RLS policies (migration 010)
// — limits staff to clinic appointments and their own home visits while admins see everything.

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAs, seedUser } from './db.ts'

const DB = 'carebook_it_access'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let adminId = ''
let staffId = ''
let otherStaffId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  adminId = seedUser(DB, 'admin')
  staffId = seedUser(DB, 'staff')
  otherStaffId = seedUser(DB, 'staff')
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function rpc(userId: string, expr: string): Record<string, unknown> {
  return JSON.parse(queryAs(DB, userId, `select ${expr}`))
}

function canAccess(userId: string, type: string, createdBy: string | null, assignedTo: string | null): boolean {
  const arg = (v: string | null) => (v === null ? 'null' : `'${v}'`)
  const out = queryAs(
    DB,
    userId,
    `select public.can_access_appointment('${type}', ${arg(createdBy)}, ${arg(assignedTo)})`
  )
  return out === 't'
}

test('staff cannot record a payment', { skip }, () => {
  const patient = query(DB, `insert into patients (name, phone) values ('P', '1') returning id`)
  const res = rpc(staffId, `public.record_payment('${patient}', null, 500, 'cash', current_date, null)`)
  assert.equal(res.success, false)
  assert.equal(res.errorCode, '42501')
})

test('staff cannot create a billing entry', { skip }, () => {
  const patient = query(DB, `insert into patients (name, phone) values ('P2', '1') returning id`)
  const res = rpc(
    staffId,
    `public.record_billing_entry('${patient}', 'payment_only', null, null, null, null, 500, 'cash', current_date, null)`
  )
  assert.equal(res.success, false)
  assert.equal(res.errorCode, '42501')
})

test('admin can record a billing entry', { skip }, () => {
  const patient = query(DB, `insert into patients (name, phone) values ('P3', '1') returning id`)
  const res = rpc(
    adminId,
    `public.record_billing_entry('${patient}', 'payment_only', null, null, null, null, 500, 'cash', current_date, null)`
  )
  assert.equal(res.success, true)
})

test('staff may access clinic appointments and their own home visits only', { skip }, () => {
  assert.equal(canAccess(staffId, 'clinic', otherStaffId, otherStaffId), true, 'clinic is shared')
  assert.equal(canAccess(staffId, 'home_visit', staffId, null), true, 'own created home visit')
  assert.equal(canAccess(staffId, 'home_visit', null, staffId), true, 'home visit assigned to them')
  assert.equal(canAccess(staffId, 'home_visit', otherStaffId, otherStaffId), false, "another staff's home visit")
})

test('clinic home visits are restricted to creator/assignee like personal home visits', { skip }, () => {
  assert.equal(canAccess(staffId, 'clinic_home_visit', staffId, null), true, 'own created clinic home visit')
  assert.equal(canAccess(staffId, 'clinic_home_visit', null, staffId), true, 'clinic home visit assigned to them')
  assert.equal(
    canAccess(staffId, 'clinic_home_visit', otherStaffId, otherStaffId),
    false,
    "another staff's clinic home visit is hidden (not broadly visible like clinic)",
  )
})

test('admin may access any appointment', { skip }, () => {
  assert.equal(canAccess(adminId, 'home_visit', otherStaffId, otherStaffId), true)
  assert.equal(canAccess(adminId, 'clinic_home_visit', otherStaffId, otherStaffId), true)
})

test('an anonymous session can access nothing', { skip }, () => {
  assert.equal(canAccess('', 'clinic', null, null), false)
})
