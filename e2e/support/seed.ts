// Idempotent seed for the local Supabase stack. Safe to re-run: clinics/patients/packages are
// upserted by fixed IDs, and auth users are created-or-found by email. Run once by the Playwright
// `setup` project before any spec (see e2e/setup/global.setup.ts).

import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient } from './supabase-admin'
import { ALL_ACCOUNTS, CLINIC_A, CLINIC_B, PASSWORD, type Account } from './accounts'
import { SEED } from './ids'

async function upsertClinic(db: SupabaseClient, clinic: { id: string; name: string }) {
  const { error } = await db.from('clinics').upsert(
    { id: clinic.id, name: clinic.name, status: 'active' },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`seed clinic ${clinic.name}: ${error.message}`)

  // global_settings isn't auto-created on clinic insert (appointment_types are). Add one if absent.
  const { count } = await db
    .from('global_settings')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinic.id)
  if (!count) {
    const { error: gsError } = await db
      .from('global_settings')
      .insert({ clinic_id: clinic.id, clinic_fee: 800, home_visit_fee: 1000 })
    if (gsError) throw new Error(`seed global_settings ${clinic.name}: ${gsError.message}`)
  }
}

/** Create the auth user if missing (idempotent), returning its id. */
async function ensureAuthUser(db: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  })
  if (!error && data.user) return data.user.id

  // Already exists — find it by paging through users (local stack has a small user set).
  for (let page = 1; page <= 20; page++) {
    const { data: list, error: listError } = await db.auth.admin.listUsers({ page, perPage: 200 })
    if (listError) throw new Error(`listUsers: ${listError.message}`)
    const found = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (found) return found.id
    if (list.users.length < 200) break
  }
  throw new Error(`could not create or find auth user ${email}: ${error?.message ?? 'unknown'}`)
}

async function seedAccount(db: SupabaseClient, account: Account) {
  const id = await ensureAuthUser(db, account.email)
  // The handle_new_user trigger creates a profile on signup; pin its role/clinic/status here.
  const { error } = await db.from('profiles').upsert(
    {
      id,
      email: account.email,
      role: account.role,
      clinic_id: account.clinicId,
      status: 'active',
      full_name: account.email.split('@')[0],
    },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`seed profile ${account.email}: ${error.message}`)
}

async function seedPatients(db: SupabaseClient) {
  const rows = [
    { id: SEED.patientAsha, clinic_id: CLINIC_A.id, name: 'Asha Rao', phone: '9876500001' },
    { id: SEED.patientRavi, clinic_id: CLINIC_A.id, name: 'Ravi Kumar', phone: '9876500002' },
    { id: SEED.patientClinicB, clinic_id: CLINIC_B.id, name: 'Clinic B Patient', phone: '9876500003' },
  ]
  const { error } = await db.from('patients').upsert(rows, { onConflict: 'id' })
  if (error) throw new Error(`seed patients: ${error.message}`)
}

async function seedPackage(db: SupabaseClient) {
  // Active prepaid package. created_at defaults to now() — a full timestamptz, which is exactly
  // what crashed the Billing → Packages tab before the formatDateOnly fix. The billing smoke
  // spec opens this tab to guard that regression.
  const { error } = await db.from('packages').upsert(
    {
      id: SEED.packageAsha,
      clinic_id: CLINIC_A.id,
      patient_id: SEED.patientAsha,
      name: '10-Session Physiotherapy Package',
      total_sessions: 10,
      used_sessions: 3,
      total_amount: 8000,
      per_session_amount: 800,
      paid_amount: 8000,
      payment_timing: 'prepaid',
      status: 'active',
    },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`seed package: ${error.message}`)
}

/** Seed clinics, accounts, patients, and a package. Idempotent. */
export async function seedDatabase(): Promise<void> {
  const db = adminClient()
  await upsertClinic(db, CLINIC_A)
  await upsertClinic(db, CLINIC_B)
  for (const account of ALL_ACCOUNTS) await seedAccount(db, account)
  await seedPatients(db)
  await seedPackage(db)
}
