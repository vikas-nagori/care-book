// Non-admin (staff) authorization enforced at the database layer: the billing RPCs reject staff,
// and can_access_appointment() — the predicate behind the appointments RLS policies (migration 010)
// — limits staff to clinic appointments and their own home visits while admins see everything.

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAs, seedUser } from './db.ts'

const DB = 'carebook_it_access'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let adminId = ''
let staffId = ''
let otherStaffId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Access Control Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  staffId = seedUser(DB, 'staff', clinicId)
  otherStaffId = seedUser(DB, 'staff', clinicId)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function rpc(userId: string, expr: string): Record<string, unknown> {
  return JSON.parse(queryAs(DB, userId, `select ${expr}`))
}

// Visibility now keys off is_shared (migration 028) rather than the 'clinic' magic
// string: shared types are visible to all staff, non-shared only to creator/assignee.
function canAccess(userId: string, isShared: boolean, createdBy: string | null, assignedTo: string | null): boolean {
  const arg = (v: string | null) => (v === null ? 'null' : `'${v}'`)
  const out = queryAs(
    DB,
    userId,
    `select public.can_access_appointment(${isShared}, ${arg(createdBy)}, ${arg(assignedTo)})`
  )
  return out === 't'
}

test('staff cannot record a payment', { skip }, () => {
  const patient = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'P', '1') returning id`)
  const res = rpc(staffId, `public.record_payment('${patient}', null, 500, 'cash', current_date, null)`)
  assert.equal(res.success, false)
  assert.equal(res.errorCode, '42501')
})

test('staff cannot create a billing entry', { skip }, () => {
  const patient = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'P2', '1') returning id`)
  const res = rpc(
    staffId,
    `public.record_billing_entry('${patient}', 'payment_only', null, null, null, null, 500, 'cash', current_date, null)`
  )
  assert.equal(res.success, false)
  assert.equal(res.errorCode, '42501')
})

test('admin can record a billing entry', { skip }, () => {
  const patient = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'P3', '1') returning id`)
  const res = rpc(
    adminId,
    `public.record_billing_entry('${patient}', 'payment_only', null, null, null, null, 500, 'cash', current_date, null)`
  )
  assert.equal(res.success, true)
})

test('staff may access shared appointments and their own restricted ones only', { skip }, () => {
  assert.equal(canAccess(staffId, true, otherStaffId, otherStaffId), true, 'shared type is visible to all staff')
  assert.equal(canAccess(staffId, false, staffId, null), true, 'own created restricted appointment')
  assert.equal(canAccess(staffId, false, null, staffId), true, 'restricted appointment assigned to them')
  assert.equal(canAccess(staffId, false, otherStaffId, otherStaffId), false, "another staff's restricted appointment")
})

test('admin may access any appointment', { skip }, () => {
  assert.equal(canAccess(adminId, false, otherStaffId, otherStaffId), true)
})

test('an anonymous session can access nothing', { skip }, () => {
  assert.equal(canAccess('', true, null, null), false)
})
