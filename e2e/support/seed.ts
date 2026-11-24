// Idempotent seed for the local Supabase stack. Baseline records are upserted by fixed IDs, and
// auth users are created-or-found by email. The pretest script and Playwright setup project may
// both run it safely (see e2e/setup/global.setup.ts).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { adminClient } from './supabase-admin.ts'
import {
  ADMIN,
  ALL_ACCOUNTS,
  CLINIC_A,
  CLINIC_B,
  CLINIC_B_ADMIN,
  EXTERNAL,
  PASSWORD,
  STAFF2,
  type Account,
} from './accounts.ts'
import { SEED, SPARSE_NAMES, SPARSE_PROFILES } from './ids.ts'
import { clinicDate, upcomingClinicSlot } from './clinic-date.ts'

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
async function ensureAuthUser(db: SupabaseClient, email: string, mobile: string): Promise<string> {
  const phone = mobile
  const { data, error } = await db.auth.admin.createUser({
    email,
    phone,
    phone_confirm: true,
    password: PASSWORD,
    email_confirm: true,
  })
  if (!error && data.user) return data.user.id

  // Already exists — find it by paging through users (local stack has a small user set).
  for (let page = 1; page <= 20; page++) {
    const { data: list, error: listError } = await db.auth.admin.listUsers({ page, perPage: 200 })
    if (listError) throw new Error(`listUsers: ${listError.message}`)
    const found = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (found) {
      // A stack seeded before mobile sign-in: attach the number so the account can sign in with it.
      if (found.phone !== phone) {
        const { error: phoneError } = await db.auth.admin.updateUserById(found.id, { phone, phone_confirm: true })
        if (phoneError) throw new Error(`attach phone to ${email}: ${phoneError.message}`)
      }
      return found.id
    }
    if (list.users.length < 200) break
  }
  throw new Error(`could not create or find auth user ${email}: ${error?.message ?? 'unknown'}`)
}

async function seedAccount(db: SupabaseClient, account: Account): Promise<string> {
  const id = await ensureAuthUser(db, account.email, account.mobile)
  // The handle_new_user trigger creates a profile on signup; pin its role/clinic/status here.
  const { error } = await db.from('profiles').upsert(
    {
      id,
      email: account.email,
      role: account.role,
      clinic_id: account.clinicId,
      status: 'active',
      full_name: account.email.split('@')[0],
      mobile_number: account.mobile,
    },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`seed profile ${account.email}: ${error.message}`)
  return id
}

async function seedPatients(db: SupabaseClient) {
  const rows = [
    {
      id: SEED.patientAsha,
      clinic_id: CLINIC_A.id,
      name: 'Asha Rao',
      phone: '9876500001',
      gender: 'female',
    },
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

async function seedExternalCoordination(db: SupabaseClient, accountIds: Map<string, string>) {
  const externalId = accountIds.get(EXTERNAL.slug)!
  const { error } = await db.from('patients').upsert({
    id: SEED.patientExternal,
    clinic_id: CLINIC_A.id,
    name: 'Leela Shared Patient',
    phone: '9876500010',
    email: 'leela@example.test',
    dob: '1990-03-10',
    gender: 'female',
    address: '10 Example Lane',
    medical_history: 'PRIVATE_CLINICAL_SENTINEL',
    notes: 'PRIVATE_PATIENT_NOTES_SENTINEL',
  }, { onConflict: 'id' })
  if (error) throw new Error(`seed external patient: ${error.message}`)

  // The management RPC requires an actual active clinic admin, even in disposable fixtures.
  const actor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const login = await actor.auth.signInWithPassword({ email: ADMIN.email, password: PASSWORD })
  if (login.error) throw new Error(`seed external admin login: ${login.error.message}`)
  try {
    const grants = await actor.rpc('replace_patient_external_access', {
      p_patient_id: SEED.patientExternal, p_profile_ids: [externalId],
    })
    if (grants.error) throw new Error(`seed external access: ${grants.error.message}`)
    const typeId = await appointmentTypeId(db, CLINIC_A.id, true)
    const booking = await actor.from('appointments').upsert({
      id: SEED.appointmentExternal,
      clinic_id: CLINIC_A.id,
      patient_id: SEED.patientExternal,
      date: clinicDate(),
      time: '11:15',
      duration_minutes: 45,
      appointment_type_id: typeId,
      type: 'Clinic',
      status: 'scheduled',
      fee: 800,
      notes: 'PRIVATE_APPOINTMENT_NOTES_SENTINEL',
      external_profile_id: externalId,
      assigned_to: null,
      external_staff_id: null,
    }, { onConflict: 'id' })
    if (booking.error) throw new Error(`seed external appointment: ${booking.error.message}`)
  } finally {
    await actor.auth.signOut({ scope: 'local' })
  }
}

async function seedPackage(db: SupabaseClient) {
  // Active prepaid package. created_at defaults to now() — a full timestamptz, which is exactly
  // what crashed the Billing → Packages tab before the formatDateOnly fix. The billing smoke
  // spec opens this tab to guard that regression.
  const clinicASharedType = await appointmentTypeId(db, CLINIC_A.id, true)
  const { error } = await db.from('packages').upsert(
    {
      id: SEED.packageAsha,
      clinic_id: CLINIC_A.id,
      patient_id: SEED.patientAsha,
      name: '10-Session Physiotherapy Package',
      total_sessions: 10,
      used_sessions: 0,
      total_amount: 8000,
      per_session_amount: 800,
      paid_amount: 8000,
      payment_timing: 'prepaid',
      status: 'active',
      appointment_type_id: clinicASharedType,
      starts_on: clinicDate(-2),
      billing_version: 2,
    },
    { onConflict: 'id', ignoreDuplicates: true },
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
  const dashboardNext = upcomingClinicSlot()
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
      // The responsive schedule contract asserts this stable display time. The separate rolling
      // appointment below owns the dashboard "Up next" guarantee across the clinic-day boundary.
      time: '23:59',
      fee: 800,
      status: 'scheduled',
      payment_status: 'unpaid',
      created_by: accountId(ADMIN),
      assigned_to: null,
    },
    {
      id: SEED.appointmentDashboardNext,
      clinic_id: CLINIC_A.id,
      patient_id: SEED.patientPaymentDue,
      appointment_type_id: clinicASharedType,
      type: 'Clinic',
      type_is_shared: true,
      date: dashboardNext.date,
      time: dashboardNext.time,
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
      funding_scope: 'package',
      status: 'posted',
      billing_version: 2,
    },
    { onConflict: 'id', ignoreDuplicates: true },
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

/** Create-or-find an auth user that may have no email (found by its mobile number then). */
async function ensureSparseAuthUser(db: SupabaseClient, input: { email: string | null; mobile: string }): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({
    ...(input.email ? { email: input.email, email_confirm: true } : {}),
    phone: input.mobile,
    phone_confirm: true,
    password: PASSWORD,
  })
  if (!error && data.user) return data.user.id
  for (let page = 1; page <= 20; page++) {
    const { data: list, error: listError } = await db.auth.admin.listUsers({ page, perPage: 200 })
    if (listError) throw new Error(`listUsers: ${listError.message}`)
    const found = list.users.find((user) => user.phone === input.mobile
      || (input.email !== null && user.email?.toLowerCase() === input.email))
    if (found) return found.id
    if (list.users.length < 200) break
  }
  throw new Error(`could not create or find sparse auth user ${input.mobile}: ${error?.message ?? 'unknown'}`)
}

/**
 * Plan F3: rows whose optional columns are all NULL, so route smoke and every list renders them.
 * Each is checked against its table's constraints and upserted by a fixed ID (see ids.ts). Ledger
 * rows (payments, packages) cannot be rewritten once posted, so they are insert-if-missing.
 */
async function seedSparseFixtures(db: SupabaseClient, accountIds: ReadonlyMap<string, string>) {
  const adminId = accountIds.get(ADMIN.slug)!
  const externalId = accountIds.get(EXTERNAL.slug)!
  const sharedType = await appointmentTypeId(db, CLINIC_A.id, true)
  const clinicBType = await appointmentTypeId(db, CLINIC_B.id, true)
  const fail = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`seed sparse ${what}: ${error.message}`)
  }

  fail('doctor', (await db.from('doctors').upsert({
    id: SEED.doctorSparse, clinic_id: CLINIC_A.id, name: SPARSE_NAMES.doctor, specialty: null, address: null,
  }, { onConflict: 'id' })).error)

  fail('patients', (await db.from('patients').upsert([
    { id: SEED.patientSparse, clinic_id: CLINIC_A.id, name: SPARSE_NAMES.patient },
    {
      id: SEED.patientReferredByDoctor, clinic_id: CLINIC_A.id, name: SPARSE_NAMES.patientReferredByDoctor,
      referral_source: 'doctor', referred_by_doctor_id: SEED.doctorSparse,
    },
    { id: SEED.patientExternalSparse, clinic_id: CLINIC_A.id, name: SPARSE_NAMES.patientExternal },
  ], { onConflict: 'id' })).error)

  fail('appointment', (await db.from('appointments').upsert({
    id: SEED.appointmentSparse,
    clinic_id: CLINIC_A.id,
    patient_id: SEED.patientSparse,
    appointment_type_id: sharedType,
    type: 'Clinic',
    type_is_shared: true,
    date: clinicDate(-120),
    time: '10:00',
    status: 'completed',
    payment_status: 'unpaid',
    fee: null,
    notes: null,
    created_by: adminId,
    assigned_to: null,
  }, { onConflict: 'id' })).error)

  fail('session note', (await db.from('session_notes').upsert({
    id: SEED.sessionNoteSparse, appointment_id: SEED.appointmentSparse,
    subjective: null, objective: null, assessment: null, plan: null, exercises_prescribed: null,
  }, { onConflict: 'id' })).error)

  fail('treatment plan', (await db.from('treatment_plans').upsert({
    id: SEED.treatmentPlanSparse, clinic_id: CLINIC_A.id, patient_id: SEED.patientSparse,
    diagnosis: SPARSE_NAMES.treatmentPlanDiagnosis, start_date: clinicDate(-120),
    goals: null, expected_end_date: null, status: 'active',
  }, { onConflict: 'id' })).error)

  // billing_version 1 is the pre-ledger shape: no appointment type, no start date.
  fail('legacy package', (await db.from('packages').upsert({
    id: SEED.packageSparse, clinic_id: CLINIC_A.id, patient_id: SEED.patientSparse,
    name: SPARSE_NAMES.packageLegacy, total_sessions: 4, used_sessions: 0, total_amount: 2000,
    per_session_amount: 500, paid_amount: 0, payment_timing: 'prepaid', status: 'active',
    appointment_type_id: null, starts_on: null, billing_version: 1,
  }, { onConflict: 'id', ignoreDuplicates: true })).error)

  fail('payment', (await db.from('payments').upsert({
    id: SEED.paymentSparse, clinic_id: CLINIC_A.id, patient_id: SEED.patientSparse,
    package_id: null, appointment_id: null, amount: 500, payment_method: 'Cash',
    date: clinicDate(-120), notes: null, funding_scope: 'ordinary', status: 'posted', billing_version: 2,
  }, { onConflict: 'id', ignoreDuplicates: true })).error)

  fail('Clinic B package', (await db.from('packages').upsert({
    id: SEED.packageClinicB, clinic_id: CLINIC_B.id, patient_id: SEED.patientClinicB,
    name: SPARSE_NAMES.packageClinicB, total_sessions: 5, used_sessions: 0, total_amount: 4000,
    per_session_amount: 800, paid_amount: 0, payment_timing: 'prepaid', status: 'active',
    appointment_type_id: clinicBType, starts_on: clinicDate(-2), billing_version: 2,
  }, { onConflict: 'id', ignoreDuplicates: true })).error)

  fail('reminder', (await db.from('reminders').upsert({
    id: SEED.reminderSparse, clinic_id: CLINIC_A.id, title: SPARSE_NAMES.reminderTitle, date: clinicDate(0),
    time: null, patient_id: null, contact_name: null, phone: null, notes: null, status: 'pending',
  }, { onConflict: 'id' })).error)

  fail('temporary staff', (await db.from('external_staff').upsert({
    id: SEED.externalStaffSparse, clinic_id: CLINIC_A.id, name: SPARSE_NAMES.externalStaff,
    phone: SPARSE_NAMES.externalStaffPhone, email: null, notes: null, status: 'active',
  }, { onConflict: 'id' })).error)

  fail('invites', (await db.from('user_invites').upsert([
    {
      id: SEED.inviteMobileOnly, clinic_id: CLINIC_A.id, email: null, role: 'staff', status: 'pending',
      auth_user_id: null, invited_by: adminId, full_name: SPARSE_NAMES.inviteMobileOnly.fullName,
      mobile_number: SPARSE_NAMES.inviteMobileOnly.mobile, revoked_at: null, accepted_at: null,
    },
    {
      id: SEED.inviteLegacy, clinic_id: CLINIC_A.id, email: SPARSE_NAMES.inviteLegacy.email, role: 'staff',
      status: 'pending', auth_user_id: null, invited_by: adminId, full_name: null, mobile_number: null,
      revoked_at: null, accepted_at: null,
    },
    {
      id: SEED.inviteRevoked, clinic_id: CLINIC_A.id, email: SPARSE_NAMES.inviteRevoked.email, role: 'staff',
      status: 'revoked', auth_user_id: null, invited_by: adminId, full_name: SPARSE_NAMES.inviteRevoked.fullName,
      mobile_number: SPARSE_NAMES.inviteRevoked.mobile, revoked_at: new Date().toISOString(), accepted_at: null,
    },
  ], { onConflict: 'id' })).error)

  for (const profile of Object.values(SPARSE_PROFILES)) {
    const id = await ensureSparseAuthUser(db, profile)
    fail(`profile ${profile.mobile}`, (await db.from('profiles').upsert({
      id, email: profile.email, role: 'staff', clinic_id: CLINIC_A.id, status: 'active',
      full_name: profile.fullName, mobile_number: profile.mobile,
    }, { onConflict: 'id' })).error)
  }

  fail('onboarding request', (await db.from('clinic_onboarding_requests').upsert({
    id: SEED.onboardingPendingSparse, clinic_name: SPARSE_NAMES.onboardingClinic,
    owner_full_name: 'Sparse Pending Owner', owner_email: SPARSE_NAMES.onboardingOwnerEmail,
    owner_mobile_number: '9000000041', clinic_phone: null, clinic_address: null, status: 'pending',
    approved_by: null, approved_at: null, rejected_by: null, rejected_at: null, rejection_reason: null,
    clinic_id: null,
  }, { onConflict: 'id' })).error)

  // External Staff rows go through the same admin session the coordination fixture uses: sharing
  // needs a real clinic admin, and the assignment guard checks the grant.
  const actor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const login = await actor.auth.signInWithPassword({ email: ADMIN.email, password: PASSWORD })
  if (login.error) throw new Error(`seed sparse external admin login: ${login.error.message}`)
  try {
    fail('external grant', (await actor.rpc('replace_patient_external_access', {
      p_patient_id: SEED.patientExternalSparse, p_profile_ids: [externalId],
    })).error)
    const external = (id: string, date: string, time: string, status: string) => ({
      id, clinic_id: CLINIC_A.id, patient_id: SEED.patientExternalSparse, date, time,
      duration_minutes: 45, appointment_type_id: sharedType, type: 'Clinic', status, fee: null,
      notes: null, external_profile_id: externalId, assigned_to: null, external_staff_id: null,
    })
    fail('external appointments', (await actor.from('appointments').upsert([
      // 07:00 is the first hour of the schedule grid. Before ~07:00 IST it can be the admin's "Up next";
      // no spec asserts that card's content.
      external(SEED.appointmentExternalSparse, clinicDate(0), '07:00', 'scheduled'),
      external(SEED.externalApptYesterday, clinicDate(-1), '10:00', 'scheduled'),
      external(SEED.externalApptCompleted, clinicDate(-2), '10:00', 'completed'),
    ], { onConflict: 'id' })).error)
  } finally {
    await actor.auth.signOut({ scope: 'local' })
  }
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
  await seedExternalCoordination(db, accountIds)
  await seedPayment(db)
  await seedPendingOnboardingRequest(db)
  await seedSparseFixtures(db, accountIds)
}
