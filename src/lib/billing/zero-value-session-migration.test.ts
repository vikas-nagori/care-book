import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/039_zero_value_sessions_settled.sql'
)
const reconcilerPath = join(
  process.cwd(),
  'supabase/migrations/031_auditable_billing_ledger_v2.sql'
)

test('zero-value migration recreates the reconciler with a settled branch for free sessions', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  assert.match(sql, /create or replace function private\.reconcile_patient_billing_v2/i)
  assert.match(sql, /when charge\.amount <= 0 then 'paid'/i)
})

test('the settled branch is evaluated before the branches that require a positive charge', () => {
  // Scoped to the function body — the migration's header comment quotes these same fragments.
  const file = readFileSync(migrationPath, 'utf8')
  const sql = file.slice(file.indexOf('create or replace function'))

  const zeroBranch = sql.indexOf("when charge.amount <= 0 then 'paid'")
  const prepaidBranch = sql.indexOf("then 'prepaid'")
  const elseBranch = sql.indexOf("else 'unpaid'")

  assert.ok(zeroBranch > 0, 'zero-value branch is present')
  // CASE takes the first matching branch; behind the guarded ones it would never be reached.
  assert.ok(zeroBranch < prepaidBranch, 'zero-value branch precedes the prepaid branch')
  assert.ok(zeroBranch < elseBranch, 'zero-value branch precedes the unpaid fallback')
})

test('existing rows are backfilled to match what the new function derives', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  assert.match(sql, /update public\.appointments appointment/i)
  assert.match(sql, /set payment_status = 'paid'/i)
  assert.match(sql, /charge\.amount <= 0/i)
})

test('the recreated function is otherwise identical to the one migration 031 defines', () => {
  // The reconciler is 577 lines; this migration re-declares all of it to change four. If any
  // other line drifts, the two copies silently disagree about how billing reconciles.
  const migration = readFileSync(migrationPath, 'utf8')
  const original = readFileSync(reconcilerPath, 'utf8')

  const extract = (sql: string) => {
    const start = sql.indexOf('create or replace function private.reconcile_patient_billing_v2')
    assert.ok(start >= 0, 'reconciler definition found')
    const end = sql.indexOf('\n$$;', start)
    assert.ok(end > start, 'reconciler terminator found')
    return sql.slice(start, end)
  }

  const added = [
    '        -- A zero-value session has nothing to collect, so it is settled the moment it exists.\n',
    '        -- Every branch below requires charge.amount > 0, so without this one a free session\n',
    "        -- falls through to 'unpaid' and stays there forever, showing up in every due list.\n",
    "        when charge.amount <= 0 then 'paid'\n",
  ].join('')

  assert.equal(extract(migration).replace(added, ''), extract(original))
})
