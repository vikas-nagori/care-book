import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'

import { buildDatabase, dropDatabase, postgresAvailable, query, queryAsAuthenticated } from './db.ts'
import { PAYMENT_METHODS, normalizePaymentMethod } from '../../src/lib/mcp/payment-method.ts'

const DB = 'carebook_it_mcp_payment_method'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let adminId = ''
let patientId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  const clinicId = query(DB, `insert into clinics (name) values ('Method Clinic') returning id`)
  adminId = query(DB, `insert into auth.users (email) values ('method-admin@test.local') returning id`)
  query(DB, `update public.profiles set role='admin', clinic_id='${clinicId}' where id='${adminId}'`)
  patientId = query(DB, `insert into patients (clinic_id, name, phone) values ('${clinicId}','Method Patient','9990000009') returning id`)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function recordPayment(method: string): { success?: boolean; message?: string } {
  const raw = queryAsAuthenticated(
    DB,
    adminId,
    `select record_payment_v2('${patientId}'::uuid, 'ordinary', null, 100, '${method}', current_date, 'method test')::text`
  )
  return JSON.parse(raw) as { success?: boolean; message?: string }
}

test('every method the app offers is accepted by the billing RPC', { skip }, () => {
  // Pins the TypeScript list to what the database actually enforces. If the RPC's accepted set
  // ever changes, this fails here rather than as a generic save error in front of a user.
  for (const method of PAYMENT_METHODS) {
    const result = recordPayment(method)
    assert.equal(result.success, true, `${method} was rejected: ${result.message ?? 'no message'}`)
  }
})

test('the RPC rejects a differently-cased method, which is what normalization prevents', { skip }, () => {
  const result = recordPayment('UPI')
  assert.equal(result.success, false)
  assert.match(String(result.message), /valid payment method/i)
  // The app normalizes before it ever reaches the database.
  assert.equal(normalizePaymentMethod('UPI'), 'upi')
})

test('the rejection message is specific enough to act on', { skip }, () => {
  // migration 037 routes deliberate rejections through private.billing_error_response, which keeps
  // end-user messages intact — so surfacing it to the caller is safe and actionable.
  const result = recordPayment('Google Pay')
  assert.equal(result.success, false)
  assert.ok(String(result.message).length > 0, 'expected the RPC to explain the rejection')
})
