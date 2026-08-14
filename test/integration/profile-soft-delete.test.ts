import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDatabase,
  dropDatabase,
  postgresAvailable,
  query,
  queryAs,
  queryAsAuthenticated,
  seedUser,
} from './db.ts'

const DB = 'carebook_it_profile_soft_delete'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let actorId = ''
let deleterId = ''
let adjustmentId = ''
let refundId = ''
let reversalId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Soft Delete Clinic') returning id`)
  actorId = seedUser(DB, 'admin', clinicId, 'actor@test.local')
  deleterId = seedUser(DB, 'admin', clinicId, 'platform@test.local')
  const patientId = query(
    DB,
    `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'Audit Patient', '1') returning id`,
  )
  const appointmentTypeId = query(
    DB,
    `select id from appointment_types where clinic_id = '${clinicId}' and name = 'Clinic'`,
  )
  const appointmentId = query(
    DB,
    `insert into appointments (clinic_id, patient_id, appointment_type_id, date, time, fee, status, created_by)
     values ('${clinicId}', '${patientId}', '${appointmentTypeId}', date '2026-08-10', time '09:00', 100, 'completed', '${actorId}')
     returning id`,
  )

  const adjustment = JSON.parse(
    queryAs(DB, actorId, `select public.adjust_appointment_fee('${appointmentId}', 120, 'actor history')`),
  )
  const payment = JSON.parse(
    queryAs(DB, actorId, `select public.record_payment_v2('${patientId}', 'ordinary', null, 150, 'cash', current_date, null)`),
  )
  const refund = JSON.parse(
    queryAs(DB, actorId, `select public.record_refund('${payment.paymentId}', 20, 'upi', current_date, 'actor history')`),
  )
  const reversal = JSON.parse(
    queryAs(DB, actorId, `select public.void_refund('${refund.refundId}', 'actor history')`),
  )
  adjustmentId = adjustment.adjustmentId
  refundId = refund.refundId
  reversalId = reversal.refundReversalId
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

test('soft deletion retains auth identity and immutable billing actor references while disabling access', { skip }, () => {
  const beforeRows = query(
    DB,
    `select jsonb_build_object(
       'adjustment', (select to_jsonb(row) from appointment_charge_adjustments row where id = '${adjustmentId}'),
       'refund', (select to_jsonb(row) from refunds row where id = '${refundId}'),
       'reversal', (select to_jsonb(row) from refund_reversals row where id = '${reversalId}')
     )`,
  )

  query(
    DB,
    `set request.jwt.claim.role = 'service_role';
     update profiles
     set status = 'deleted', deleted_at = now(), deleted_by = '${deleterId}', deletion_reason = 'left clinic'
     where id = '${actorId}';
     reset request.jwt.claim.role`,
  )

  assert.equal(query(DB, `select count(*) from auth.users where id = '${actorId}'`), '1')
  assert.equal(query(DB, `select status || '/' || deletion_reason from profiles where id = '${actorId}'`), 'deleted/left clinic')
  assert.equal(queryAs(DB, actorId, `select public.has_role(array['admin']::text[])`), 'f')
  assert.equal(queryAsAuthenticated(DB, actorId, 'select count(*) from patients'), '0')
  assert.equal(
    query(DB, `select created_by from appointment_charge_adjustments where id = '${adjustmentId}'`),
    actorId,
  )
  assert.equal(query(DB, `select created_by from refunds where id = '${refundId}'`), actorId)
  assert.equal(query(DB, `select created_by from refund_reversals where id = '${reversalId}'`), actorId)
  assert.equal(
    query(
      DB,
      `select jsonb_build_object(
         'adjustment', (select to_jsonb(row) from appointment_charge_adjustments row where id = '${adjustmentId}'),
         'refund', (select to_jsonb(row) from refunds row where id = '${refundId}'),
         'reversal', (select to_jsonb(row) from refund_reversals row where id = '${reversalId}')
       )`,
    ),
    beforeRows,
  )
  assert.throws(
    () => query(DB, `delete from auth.users where id = '${actorId}'`),
    /cannot be hard-deleted|must be soft-deleted|foreign key|violates/i,
  )
})

test('deleted profiles cannot be unblocked, rewritten, or deleted by authenticated clinic admins', { skip }, () => {
  for (const statement of [
    `update profiles set status = 'active' where id = '${actorId}'`,
    `update profiles set status = 'blocked' where id = '${actorId}'`,
    `update profiles set deletion_reason = 'forged' where id = '${actorId}'`,
  ]) {
    assert.throws(() => query(DB, statement), /soft-deleted profile lifecycle is immutable/i)
  }

  const targetId = seedUser(DB, 'staff', clinicId, 'target@test.local')
  assert.throws(
    () => query(
      DB,
      `set request.jwt.claim.role = 'service_role';
       set carebook.validated_e2e_cleanup_user = '${targetId}';
       delete from profiles where id = '${targetId}';
       reset carebook.validated_e2e_cleanup_user;
       reset request.jwt.claim.role`,
    ),
    /cannot be hard-deleted|must be soft-deleted/i,
  )
  assert.throws(
    () => query(
      DB,
      `set request.jwt.claim.role = 'service_role';
       delete from profiles where id = '${targetId}';
       reset request.jwt.claim.role`,
    ),
    /cannot be hard-deleted|must be soft-deleted/i,
  )
  assert.throws(
    () => queryAsAuthenticated(DB, deleterId, `delete from profiles where id = '${targetId}'`),
    /must be soft-deleted|permission denied/i,
  )
  assert.throws(
    () => queryAsAuthenticated(
      DB,
      deleterId,
      `update profiles set status = 'deleted', deleted_at = now(), deleted_by = '${deleterId}', deletion_reason = 'forged' where id = '${targetId}'`,
    ),
    /service role|permission denied/i,
  )

  query(
    DB,
    `set request.jwt.claim.role = 'service_role';
     update profiles
     set status = 'deleted', deleted_at = now(), deleted_by = '${deleterId}', deletion_reason = 'left clinic'
     where id = '${targetId}';
     reset request.jwt.claim.role`,
  )
  assert.throws(
    () => queryAsAuthenticated(DB, deleterId, `delete from profiles where id = '${targetId}'`),
    /must be soft-deleted|permission denied/i,
  )

  const patientId = query(
    DB,
    `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'Assignment Patient', '2') returning id`,
  )
  const homeTypeId = query(
    DB,
    `select id from appointment_types where clinic_id = '${clinicId}' and name = 'Home'`,
  )
  assert.throws(
    () => query(
      DB,
      `insert into appointments (
         clinic_id, patient_id, appointment_type_id, date, time, fee, status, created_by, assigned_to
       ) values (
         '${clinicId}', '${patientId}', '${homeTypeId}', date '2026-08-20', time '09:00', 100, 'scheduled', '${deleterId}', '${targetId}'
       )`,
    ),
    /active assignee/i,
  )
})

test('hard deletion requires an explicitly marked disposable E2E identity with no history', { skip }, () => {
  const disposableId = seedUser(DB, 'staff', clinicId, 'no-history@carebook.test')

  assert.throws(
    () => query(DB, `delete from auth.users where id = '${disposableId}'`),
    /cannot be hard-deleted|must be soft-deleted/i,
  )
  assert.equal(query(DB, `select count(*) from auth.users where id = '${disposableId}'`), '1')
  assert.equal(query(DB, `select count(*) from profiles where id = '${disposableId}'`), '1')

  assert.throws(
    () => query(
      DB,
      `set request.jwt.claim.role = 'service_role';
       delete from auth.users where id = '${disposableId}';
       reset request.jwt.claim.role`,
    ),
    /production identities cannot be hard-deleted/i,
  )

  query(
    DB,
    `set request.jwt.claim.role = 'service_role';
     update auth.users
     set raw_app_meta_data = jsonb_build_object(
       'carebook_e2e_cleanup', jsonb_build_object('state', 'requested', 'reason', 'Playwright test cleanup')
     )
     where id = '${disposableId}';
     delete from profiles where id = '${disposableId}';
     delete from auth.users where id = '${disposableId}';
     reset request.jwt.claim.role`,
  )
  assert.equal(query(DB, `select count(*) from auth.users where id = '${disposableId}'`), '0')
  assert.equal(query(DB, `select count(*) from profiles where id = '${disposableId}'`), '0')

  const authAdminDisposableId = seedUser(DB, 'staff', clinicId, 'auth-admin-cleanup@carebook.test')
  query(
    DB,
    `update auth.users
     set raw_app_meta_data = jsonb_build_object(
       'carebook_e2e_cleanup', jsonb_build_object('state', 'requested', 'reason', 'Auth admin cleanup')
     )
     where id = '${authAdminDisposableId}'`,
  )
  query(
    DB,
    `set role supabase_auth_admin;
     delete from auth.users where id = '${authAdminDisposableId}';
     reset role`,
  )
  assert.equal(query(DB, `select count(*) from auth.users where id = '${authAdminDisposableId}'`), '0')
  assert.equal(query(DB, `select count(*) from profiles where id = '${authAdminDisposableId}'`), '0')
})
