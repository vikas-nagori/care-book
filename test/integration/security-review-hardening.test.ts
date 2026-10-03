// Covers the database-side fixes from the 2026-08-15 whole-codebase security review:
//   * migration 036 — anon can no longer insert clinic onboarding requests
//   * migration 037 — billing RPCs no longer return raw sqlerrm / sqlstate to the caller
//   * migration 038 — record_payment_v2 mirrors the package-collected-in-full guard

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAs, run, seedUser } from './db.ts'

const DB = 'carebook_it_security_review_hardening'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let adminId = ''
let clinicTypeId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Hardening Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  clinicTypeId = query(
    DB,
    `select id from appointment_types where clinic_id = '${clinicId}' and name = 'Clinic'`
  )
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function rpc(userId: string, expression: string): Record<string, unknown> {
  return JSON.parse(queryAs(DB, userId, `select ${expression}`))
}

function patient(label: string): string {
  return query(
    DB,
    `insert into patients (clinic_id, name, phone) values ('${clinicId}', '${label}', '1') returning id`
  )
}

test('legacy onboarding mutations are service-only and cannot be invoked by API roles', { skip }, () => {
  const requestId = query(DB, `insert into clinic_onboarding_requests
    (clinic_name, owner_full_name, owner_email, owner_mobile_number)
    values ('Restricted RPC clinic', 'Test Owner', 'rpc-owner@test.local', '1234567890') returning id`)
  const beforeCounts = query(DB, `select json_build_array(
    (select count(*) from clinics), (select count(*) from user_invites))::text`)
  for (const [signature, call] of [
    ['public.approve_clinic_onboarding_request(uuid,uuid)', `public.approve_clinic_onboarding_request('${requestId}', '${adminId}')`],
    ['public.reject_clinic_onboarding_request(uuid,uuid,text)', `public.reject_clinic_onboarding_request('${requestId}', '${adminId}', 'test')`],
  ]) {
    for (const role of ['anon', 'authenticated']) {
      assert.equal(query(DB, `select has_function_privilege('${role}', '${signature}', 'execute')::text`), 'false')
      assert.throws(() => run(DB, `set role ${role}; select ${call}`), /permission denied for function/)
    }
    assert.equal(query(DB, `select has_function_privilege('service_role', '${signature}', 'execute')::text`), 'true')
  }
  assert.equal(query(DB, `select status from clinic_onboarding_requests where id = '${requestId}'`), 'pending')
  assert.equal(query(DB, `select json_build_array(
    (select count(*) from clinics), (select count(*) from user_invites))::text`), beforeCounts)
  run(DB, `set role service_role; select public.reject_clinic_onboarding_request('${requestId}', '${adminId}', 'test')`)
  assert.equal(query(DB, `select status from clinic_onboarding_requests where id = '${requestId}'`), 'rejected')
})

function createPackage(patientId: string, name: string, sessions: number, rate: number): string {
  const result = rpc(
    adminId,
    `public.record_billing_entry_v2(
      '${patientId}', 'package_with_payment', '${name}', ${sessions}, ${rate},
      '${clinicTypeId}', current_date, ${sessions * rate}, 'cash', current_date, 'package receipt'
    )`
  )
  assert.equal(result.success, true, `package setup failed: ${JSON.stringify(result)}`)
  return result.packageId as string
}

// --- migration 038: a package receipt must equal the package total --------------------------

// This is the exposed hole: record_payment_v2 is granted to `authenticated`, so an admin could
// POST it directly over PostgREST with p_funding_scope = 'package' and a partial amount,
// stranding a package due that no screen can collect — the state migration 035 blocks on the
// creation path.
test('record_payment_v2 rejects a package payment below the package total', { skip }, () => {
  const patientId = patient('Under Collected')
  const packageId = createPackage(patientId, 'Under package', 4, 100)

  const result = rpc(adminId, `public.record_payment_v2('${patientId}', 'package', '${packageId}', 150, 'cash', current_date, null)`)

  assert.equal(result.success, false)
  assert.equal(result.errorCode, '22023')
  assert.match(String(result.message), /collected in full/i)
})

test('record_payment_v2 rejects a package payment above the package total', { skip }, () => {
  const patientId = patient('Over Collected')
  const packageId = createPackage(patientId, 'Over package', 2, 500)

  const result = rpc(adminId, `public.record_payment_v2('${patientId}', 'package', '${packageId}', 1500, 'cash', current_date, null)`)

  assert.equal(result.success, false)
  assert.match(String(result.message), /collected in full/i)
})

test('a full-total package receipt is still accepted', { skip }, () => {
  // The guard checks the receipt against the package total, not against what has already been
  // collected: a later full-total receipt stays legal and the ledger distributes the surplus as
  // FIFO credit (see 'package receipts distribute FIFO only within their package'). Narrowing
  // that further is a billing decision, not a security one.
  const patientId = patient('Exactly Collected')
  const packageId = createPackage(patientId, 'Exact package', 3, 200)

  assert.equal(
    rpc(adminId, `public.record_payment_v2('${patientId}', 'package', '${packageId}', 600, 'cash', current_date, null)`).success,
    true
  )
})

test('record_billing_entry_v2 still creates a package paid in full', { skip }, () => {
  const patientId = patient('Fully Collected')
  const packageId = createPackage(patientId, 'Full package', 5, 120)

  assert.equal(
    query(DB, `select coalesce(sum(amount), 0)::text from payments where package_id = '${packageId}' and status = 'posted'`),
    '600.00'
  )
})

test('ordinary payments are unaffected by the package guard', { skip }, () => {
  const patientId = patient('Ordinary Payer')

  assert.equal(
    rpc(adminId, `public.record_payment_v2('${patientId}', 'ordinary', null, 250, 'cash', current_date, null)`).success,
    true
  )
})

// --- migration 037: billing RPCs must not hand raw Postgres error text to the caller ---------

test('no billing function returns sqlerrm to the caller', { skip }, () => {
  const leaking = query(
    DB,
    `select coalesce(string_agg(n.nspname || '.' || p.proname, ', '), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.prokind = 'f'
       and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
       and pg_get_functiondef(p.oid) like '%''message'', sqlerrm%'`
  )

  assert.equal(leaking, '', `functions still returning sqlerrm: ${leaking}`)
})

test('billing_error_response passes intentional messages through and masks the rest', { skip }, () => {
  const intentional = JSON.parse(
    query(DB, `select private.billing_error_response('22023', 'Payment amount must be greater than zero.')`)
  )
  assert.deepEqual(intentional, {
    success: false,
    errorCode: '22023',
    message: 'Payment amount must be greater than zero.',
  })

  // A raw Postgres error — constraint name, check expression and column names — is replaced.
  const masked = JSON.parse(
    query(
      DB,
      `select private.billing_error_response('23514', 'new row for relation "packages" violates check constraint "packages_total_amount_check"')`
    )
  )
  assert.equal(masked.errorCode, 'BILLING_MUTATION_FAILED')
  assert.doesNotMatch(String(masked.message), /packages_total_amount_check|check constraint|relation/i)
})

test('billing_error_response is not executable by anon or authenticated', { skip }, () => {
  assert.equal(
    query(DB, `select has_function_privilege('anon', 'private.billing_error_response(text, text)', 'execute')::text`),
    'false'
  )
  assert.equal(
    query(DB, `select has_function_privilege('authenticated', 'private.billing_error_response(text, text)', 'execute')::text`),
    'false'
  )
})

// --- migration 036: onboarding requests are server-action-only ------------------------------

test('anon cannot insert clinic onboarding requests directly', { skip }, () => {
  assert.throws(
    () =>
      run(
        DB,
        `set role anon;
         insert into clinic_onboarding_requests (clinic_name, owner_full_name, owner_email, owner_mobile_number, status)
         values ('Forged Clinic', 'Mallory', 'mallory@example.com', '9999999999', 'approved');
         reset role`
      ),
    /permission denied|row-level security/i
  )
})

test('authenticated cannot insert clinic onboarding requests directly', { skip }, () => {
  assert.throws(
    () =>
      run(
        DB,
        `set role authenticated;
         set request.jwt.claim.sub = '${adminId}';
         insert into clinic_onboarding_requests (clinic_name, owner_full_name, owner_email, owner_mobile_number)
         values ('Forged Clinic 2', 'Mallory', 'mallory2@example.com', '9999999998');
         reset role`
      ),
    /permission denied|row-level security/i
  )
})

test('the public onboarding insert policy is gone', { skip }, () => {
  assert.equal(
    query(
      DB,
      `select count(*)::text from pg_policies
       where tablename = 'clinic_onboarding_requests'
         and policyname = 'clinic_onboarding_requests_public_insert'`
    ),
    '0'
  )
})

test('the service-role path used by the server action still inserts', { skip }, () => {
  // createClinicOnboardingRequest goes through the service-role client, which bypasses RLS.
  const id = query(
    DB,
    `insert into clinic_onboarding_requests (clinic_name, owner_full_name, owner_email, owner_mobile_number)
     values ('Genuine Clinic', 'Owner', 'owner@example.com', '9876543210')
     returning id`
  )

  assert.match(id, /^[0-9a-f-]{36}$/)
})
