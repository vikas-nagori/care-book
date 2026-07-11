import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/024_prepaid_only_packages.sql'
)

test('prepaid-only migration constrains payment_timing to prepaid', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  assert.match(sql, /drop constraint if exists packages_payment_timing_check/i)
  assert.match(sql, /check \(payment_timing = 'prepaid'\)/i)
})

test('prepaid-only migration rewrites record_billing_entry to reject postpaid and require an amount', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  assert.match(sql, /create or replace function public\.record_billing_entry/i)
  // Non-prepaid packages are rejected.
  assert.match(sql, /coalesce\(p_package_payment_timing, 'prepaid'\) <> 'prepaid'/i)
  // Postpaid's zero-amount allowance is gone: a package always needs a positive amount.
  assert.match(sql, /Enter the amount collected for this package\./i)
})
