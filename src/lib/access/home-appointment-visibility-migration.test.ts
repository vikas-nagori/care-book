import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/010_home_visit_assignment_visibility.sql',
)

test('home appointment visibility migration adds creator and assignee tracking', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  assert.match(sql, /alter table public\.appointments/i)
  assert.match(sql, /add column if not exists created_by uuid references public\.profiles\(id\)/i)
  assert.match(sql, /add column if not exists assigned_to uuid references public\.profiles\(id\)/i)
  assert.match(sql, /create index if not exists idx_appointments_created_by/i)
  assert.match(sql, /create index if not exists idx_appointments_assigned_to/i)
  assert.match(sql, /new\.created_by := auth\.uid\(\)/i)
  assert.match(sql, /create trigger appointments_set_creator/i)
})

test('home appointment visibility migration replaces appointment and session note RLS', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  assert.match(sql, /create or replace function public\.can_access_appointment/i)
  assert.match(sql, /appointment_type = 'clinic'/i)
  assert.match(sql, /appointment_created_by = auth\.uid\(\)/i)
  assert.match(sql, /appointment_assigned_to = auth\.uid\(\)/i)
  assert.match(sql, /drop policy if exists "appointments_staff_admin_access"/i)
  assert.match(sql, /create policy "appointments_visibility_select"/i)
  assert.match(sql, /create policy "session_notes_appointment_visibility"/i)
  assert.match(sql, /where appointment_row\.id = session_notes\.appointment_id/i)
})

test('home appointment visibility migration opens profile reads for assignee picker', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  assert.match(sql, /drop policy if exists "profiles_read_self_or_admin"/i)
  assert.match(sql, /create policy "profiles_read_staff_admin"/i)
  assert.match(sql, /for select\s+using \(public\.has_role\(array\['admin', 'staff'\]\)\)/i)
})
