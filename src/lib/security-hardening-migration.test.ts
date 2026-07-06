import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const migration = () =>
  readFileSync(
    join(import.meta.dirname, '..', '..', 'supabase', 'migrations', '022_security_hardening.sql'),
    'utf8'
  )

test('security hardening migration moves internal helpers into a private schema', () => {
  const sql = migration()

  assert.match(sql, /create schema if not exists private/i)
  assert.match(sql, /create or replace function private\.current_clinic_id\(\)/i)
  assert.match(sql, /create or replace function private\.has_role\(allowed_roles text\[\]\)/i)
  assert.match(sql, /create or replace function private\.reconcile_package_usage\(target_package_id uuid\)/i)
  assert.match(sql, /create trigger appointments_sync_patient_billing_allocations[\s\S]+private\.sync_patient_billing_allocations\(\)/i)
})

test('security hardening migration revokes exposed internal RPC grants and preserves billing RPC grants', () => {
  const sql = migration()

  assert.match(sql, /revoke all on function public\.assign_patient_package_sessions\(uuid\) from public, anon, authenticated/i)
  assert.match(sql, /revoke all on function public\.allocate_patient_payment_credit\(uuid\) from public, anon, authenticated/i)
  assert.match(sql, /grant execute on function public\.record_payment\(uuid, uuid, numeric, text, date, text\) to authenticated/i)
  assert.match(sql, /grant execute on function public\.record_billing_entry\(uuid, text, text, integer, numeric, text, numeric, text, date, text\) to authenticated/i)
})

test('security hardening migration adds onboarding throttling constraints', () => {
  const sql = migration()

  assert.match(sql, /add column if not exists request_fingerprint text/i)
  assert.match(sql, /clinic_onboarding_pending_owner_email_unique/i)
  assert.match(sql, /clinic_onboarding_pending_fingerprint_idx/i)
})
