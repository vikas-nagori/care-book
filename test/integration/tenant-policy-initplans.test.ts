import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAsAuthenticated, seedUser } from './db.ts'

// Tenant/role helpers depend only on the caller, so every policy must evaluate them once per
// statement (as an InitPlan) rather than once per row. Called bare, they made the billing balance
// views run thousands of profile lookups per page load (1–3 s in production on ~100 patients).
// Behavioural isolation (cross-clinic, staff vs admin) is asserted by tenant-isolation and
// auditable-billing-ledger; this file guards the evaluation shape.

const DB = 'carebook_it_policy_initplans'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

const HELPER = /\b(?:has_role|is_same_clinic|current_clinic_id|can_access_appointment)\s*\(/

before(() => { if (hasPostgres) buildDatabase(DB) })
after(() => { if (hasPostgres) dropDatabase(DB) })

/** Remove every uncorrelated `( SELECT fn(...) AS alias)` wrapper as pg_policies deparses it. */
function stripInitplans(expression: string): string {
  return expression.replace(/\(\s*SELECT\s+(?:\w+\.)?\w+\((?:[^()]|\([^()]*\))*\)\s+AS\s+\w+\)/gi, '')
}

test('no public policy calls a tenant/role helper per row', { skip }, () => {
  const rows = query(DB, `
    select coalesce(json_agg(json_build_object('policy', tablename || '.' || policyname, 'qual', qual, 'check', with_check)), '[]')
    from pg_policies where schemaname = 'public'`)
  const offenders = (JSON.parse(rows) as Array<{ policy: string; qual: string | null; check: string | null }>)
    .filter(({ qual, check }) => [qual, check].some((expression) => expression && HELPER.test(stripInitplans(expression))))
    .map(({ policy }) => policy)
  assert.deepEqual(offenders, [])
})

test('patient balance view evaluates tenant helpers as initplans, not row filters', { skip }, () => {
  const clinic = query(DB, `insert into clinics (name) values ('Initplan clinic') returning id`)
  const admin = seedUser(DB, 'admin', clinic)
  query(DB, `insert into patients (clinic_id, name, phone) values ('${clinic}', 'Initplan patient', '1') returning id`)

  const plan = queryAsAuthenticated(DB, admin, `explain (costs off) select * from public.patient_billing_balances_v2`)
  assert.match(plan, /InitPlan/)
  for (const line of plan.split('\n').filter((entry) => /Filter:/.test(entry))) {
    assert.doesNotMatch(stripInitplans(line), HELPER, `per-row helper call in plan: ${line.trim()}`)
  }
  assert.equal(queryAsAuthenticated(DB, admin, `select count(*) from public.patient_billing_balances_v2`), '1')
})
