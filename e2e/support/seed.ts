// Idempotent seed for the local Supabase stack. Baseline records are upserted by fixed IDs, and
// auth users are created-or-found by email. The pretest script and Playwright setup project may
// both run it safely (see e2e/setup/global.setup.ts).

import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient } from './supabase-admin.ts'
import {
  ADMIN,
  ALL_ACCOUNTS,
  CLINIC_A,
  CLINIC_B,
  CLINIC_B_ADMIN,
  PASSWORD,
  STAFF2,
  type Account,
} from './accounts.ts'
import { SEED } from './ids.ts'

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

async function seedAccount(db: SupabaseClient, account: Account): Promise<string> {
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
  return id
}

async function seedPatients(db: SupabaseClient) {
  const rows = [
    { id: SEED.patientAsha, clinic_id: CLINIC_A.id, name: 'Asha Rao', phone: '9876500001' },
    { id: SEED.patientRavi, clinic_id: CLINIC_A.id, name: 'Ravi Kumar', phone: '9876500002' },
    {
      id: SEED.patientPaymentDue,
      clinic_id: CLINIC_A.id,
      name: 'Meera Payment Due',
      phone: '9876500004',
    },
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

async function seedPackageTemplate(db: SupabaseClient) {
  const { error } = await db.from('package_templates').upsert(
    {
      id: SEED.packageTemplate,
      clinic_id: CLINIC_A.id,
      name: 'E2E Standard 6 Sessions',
      min_sessions: 6,
      per_session_amount: 750,
    },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`seed package template: ${error.message}`)
}

function clinicDate(dayOffset: number): string {
  const target = new Date(Date.now() + dayOffset * 86_400_000)
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(target)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

async function appointmentTypeId(
  db: SupabaseClient,
  clinicId: string,
  isShared: boolean,
): Promise<string> {
  const { data, error } = await db
    .from('appointment_types')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('is_shared', isShared)
    .order('sort_order')
    .limit(1)
    .single()
  if (error || !data) {
    throw new Error(
      `seed appointment type (${clinicId}, shared=${isShared}): ${error?.message ?? 'missing'}`,
    )
  }
  return data.id
}

async function seedAppointments(
  db: SupabaseClient,
  accountIds: ReadonlyMap<string, string>,
) {
  const clinicASharedType = await appointmentTypeId(db, CLINIC_A.id, true)
  const clinicAPrivateType = await appointmentTypeId(db, CLINIC_A.id, false)
  const clinicBSharedType = await appointmentTypeId(db, CLINIC_B.id, true)
  const accountId = (account: Account) => {
    const id = accountIds.get(account.slug)
    if (!id) throw new Error(`seed account id missing for ${account.slug}`)
    return id
  }

  const rows = [
    {
      id: SEED.appointmentShared,
      clinic_id: CLINIC_A.id,
      patient_id: SEED.patientAsha,
      appointment_type_id: clinicASharedType,
      type: 'Clinic',
      type_is_shared: true,
      date: clinicDate(0),
      time: '10:00',
      fee: 800,
      status: 'scheduled',
      payment_status: 'unpaid',
      created_by: accountId(ADMIN),
      assigned_to: null,
    },
    {
      id: SEED.appointmentStaff2Private,
      clinic_id: CLINIC_A.id,
      patient_id: SEED.patientRavi,
      appointment_type_id: clinicAPrivateType,
      type: 'Home',
      type_is_shared: false,
      date: clinicDate(0),
      time: '11:00',
      fee: 1000,
      status: 'scheduled',
      payment_status: 'unpaid',
      created_by: accountId(STAFF2),
      assigned_to: accountId(STAFF2),
    },
    {
      id: SEED.appointmentClinicB,
      clinic_id: CLINIC_B.id,
      patient_id: SEED.patientClinicB,
      appointment_type_id: clinicBSharedType,
      type: 'Clinic',
      type_is_shared: true,
      date: clinicDate(0),
      time: '12:00',
      fee: 800,
      status: 'scheduled',
      payment_status: 'unpaid',
      created_by: accountId(CLINIC_B_ADMIN),
      assigned_to: null,
    },
    {
      id: SEED.appointmentPaymentDue,
      clinic_id: CLINIC_A.id,
      patient_id: SEED.patientPaymentDue,
      appointment_type_id: clinicASharedType,
      type: 'Clinic',
      type_is_shared: true,
      date: clinicDate(-1),
      time: '09:00',
      fee: 800,
      status: 'completed',
      payment_status: 'unpaid',
      created_by: accountId(ADMIN),
      assigned_to: null,
    },
  ]
  const { error } = await db.from('appointments').upsert(rows, { onConflict: 'id' })
  if (error) throw new Error(`seed appointments: ${error.message}`)
}

async function seedPayment(db: SupabaseClient) {
  const { error } = await db.from('payments').upsert(
    {
      id: SEED.paymentAsha,
      clinic_id: CLINIC_A.id,
      patient_id: SEED.patientAsha,
      package_id: SEED.packageAsha,
      appointment_id: null,
      amount: 8000,
      payment_method: 'UPI',
      date: clinicDate(-2),
      notes: 'E2E baseline prepaid package payment',
    },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`seed payment: ${error.message}`)
}

async function seedPendingOnboardingRequest(db: SupabaseClient) {
  const { error } = await db.from('clinic_onboarding_requests').upsert(
    {
      id: SEED.onboardingPending,
      clinic_name: 'E2E Pending Physiotherapy Clinic',
      owner_full_name: 'E2E Pending Owner',
      owner_email: 'pending-owner@carebook.test',
      owner_mobile_number: '9876500099',
      clinic_phone: '9876500098',
      clinic_address: 'E2E fixture address',
      status: 'pending',
      approved_by: null,
      approved_at: null,
      rejected_by: null,
      rejected_at: null,
      rejection_reason: null,
      clinic_id: null,
    },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`seed pending onboarding request: ${error.message}`)
}

/** Seed the fixed local baseline used by read-only and dynamic-route specs. Idempotent. */
export async function seedDatabase(): Promise<void> {
  const db = adminClient()
  await upsertClinic(db, CLINIC_A)
  await upsertClinic(db, CLINIC_B)
  const accountIds = new Map<string, string>()
  for (const account of ALL_ACCOUNTS) {
    accountIds.set(account.slug, await seedAccount(db, account))
  }
  await seedPatients(db)
  await seedPackage(db)
  await seedPackageTemplate(db)
  await seedAppointments(db, accountIds)
  await seedPayment(db)
  await seedPendingOnboardingRequest(db)
}
