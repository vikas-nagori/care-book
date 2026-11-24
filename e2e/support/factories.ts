import { randomUUID } from 'node:crypto'
import { test as base, expect, type TestInfo } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ADMIN, ALL_ACCOUNTS, CLINIC_A, CLINIC_B, EXTERNAL, PASSWORD } from './accounts.ts'
import { generateLocalInviteLink, generateLocalRecoveryLink } from './auth-links.ts'
import { clinicDate } from './clinic-date.ts'
import { SEED } from './ids.ts'
import { adminClient } from './supabase-admin.ts'

type Row = Record<string, unknown> & { id: string }
export type E2EPatientRow = Row & {
  clinic_id: string
  name: string
  phone: string | null
  email: string | null
  dob: string | null
  age_years: number | null
  age_recorded_on: string | null
  gender: string | null
  address: string | null
  medical_history: string | null
  notes: string | null
  referral_source: string | null
  referred_by_doctor_id: string | null
  referred_by_patient_id: string | null
  referral_other: string | null
}
/**
 * Columns createPatient accepts. Pass `null` to leave an optional column blank on purpose
 * (`phone: null` for a patient with no phone); omit a key to keep the default.
 */
export type E2EPatientInput = Partial<Omit<E2EPatientRow, 'id'>> & { id?: string; [key: string]: unknown }
export type E2EAppointmentRow = Row & {
  clinic_id: string
  patient_id: string
  appointment_type_id: string
  type: string
  type_is_shared: boolean
  date: string
  time: string
  duration_minutes: number
  fee: number | null
  status: string
  notes: string | null
  assigned_to: string | null
}
export type E2ESessionNoteRow = Row & {
  appointment_id: string
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  exercises_prescribed: string | null
}
export type E2EAppointmentTypeRow = Row & {
  name: string
  is_shared: boolean
  session_rate: number
}
export type E2EProfileRow = Row & {
  clinic_id: string | null
  /** NULL for a mobile-only account (see E2EMobileOnlyAuthResource); found-by-email rows have one. */
  email: string
  full_name: string | null
  role: string
  status: string
}
export type E2EClinicRow = Row & {
  name: string
  phone: string | null
  address: string | null
  status: string
}
export type E2EOnboardingRequestRow = Row & {
  clinic_name: string
  owner_full_name: string
  owner_email: string
  owner_mobile_number: string
  status: string
  clinic_id: string | null
  rejection_reason: string | null
}
export type E2EAuthResource = {
  id: string
  email: string
  /** 10-digit mobile number; the account signs in with it. */
  mobileNumber: string
  password: string
  profile: E2EProfileRow
}
/** createAuthUser({ email: null }): signs in with `mobileNumber`; profile.email is NULL. */
export type E2EMobileOnlyAuthResource = Omit<E2EAuthResource, 'email' | 'profile'> & {
  email: null
  profile: Omit<E2EProfileRow, 'email'> & { email: null }
}
type CreateAuthUserInput = {
  clinicId: string
  email?: string | null
  password?: string
  role?: 'admin' | 'staff' | 'external_staff'
  fullName?: string | null
  mobileNumber?: string
  status?: 'active' | 'blocked'
}
export type E2EPaymentRow = Row & {
  clinic_id: string
  patient_id: string
  package_id: string | null
  appointment_id: string | null
  amount: number
  payment_method: string
  date: string
  notes: string | null
}
export type E2EPackageRow = Row & {
  clinic_id: string
  patient_id: string
  name: string
  total_sessions: number
  used_sessions: number
  total_amount: number
  per_session_amount: number
  paid_amount: number
  payment_timing: string
  status: string
}
export type E2EPackageTemplateRow = Row & {
  clinic_id: string
  name: string
  min_sessions: number
  per_session_amount: number
}
export type E2EExternalStaffRow = Row & {
  clinic_id: string
  name: string
  phone: string
  email: string | null
  status: string
}
export type E2EUserInviteRow = Row & {
  clinic_id: string
  email: string | null
  role: string
  status: string
  auth_user_id: string | null
  full_name: string | null
  mobile_number: string | null
  updated_at: string
}
export type E2EReminderRow = Row & {
  clinic_id: string
  title: string
  date: string
  time: string | null
  patient_id: string | null
  contact_name: string | null
  phone: string | null
  notes: string | null
  status: string
}
export type E2ETreatmentPlanRow = Row & {
  clinic_id: string
  patient_id: string
  diagnosis: string
  goals: string | null
  start_date: string
  expected_end_date: string | null
  status: string
}
export type E2EDoctorRow = Row & {
  clinic_id: string
  name: string
  specialty: string | null
  address: string | null
}
export type E2ERefundRow = Row & {
  clinic_id: string
  patient_id: string
  payment_id: string
  amount: number
  reason: string
  refund_method: string
  refund_date: string
  created_by: string
}
export type E2EChargeAdjustmentRow = Row & {
  clinic_id: string
  patient_id: string
  appointment_id: string | null
  previous_amount: number
  adjusted_amount: number
  reason: string
  created_by: string
}
export type E2EGlobalSettingsRow = {
  id: number
  clinic_id: string
  clinic_fee: number
  home_visit_fee: number
}
type CleanupTable =
  | 'reminders'
  | 'appointment_payments'
  | 'package_session_allocations'
  | 'session_notes'
  | 'payments'
  | 'packages'
  | 'appointments'
  | 'treatment_plans'
  | 'patients'
  | 'appointment_types'
  | 'package_templates'
  | 'external_staff'
  | 'user_invites'
  | 'clinic_onboarding_requests'
  | 'doctors'
  | 'global_settings'
  | 'profiles'
  | 'clinics'

// Refunds and fee adjustments are immutable ledger rows: they are removed, before their payments,
// only by the cleanup_e2e_patient RPC for disposable `E2E …` patients (see cleanup()). Disposable
// auth users are deleted last, after every row that counts as their retained history.
const cleanupOrder: CleanupTable[] = [
  'reminders',
  'appointment_payments',
  'package_session_allocations',
  'session_notes',
  'user_invites',
  'payments',
  'packages',
  'appointments',
  'treatment_plans',
  'patients',
  'appointment_types',
  'package_templates',
  'external_staff',
  'doctors',
  'clinic_onboarding_requests',
  'global_settings',
  'profiles',
  'clinics',
]

const clinicScopedCleanupTables: CleanupTable[] = [
  'reminders',
  'user_invites',
  'payments',
  'packages',
  'appointments',
  'treatment_plans',
  'patients',
  'appointment_types',
  'package_templates',
  'external_staff',
  'doctors',
  'global_settings',
  'profiles',
]

const protectedIdsByTable: Partial<Record<CleanupTable, ReadonlySet<string>>> = {
  appointments: new Set([
    SEED.appointmentShared,
    SEED.appointmentDashboardNext,
    SEED.appointmentStaff2Private,
    SEED.appointmentClinicB,
    SEED.appointmentPaymentDue,
    SEED.appointmentExternal,
    SEED.appointmentSparse,
    SEED.appointmentExternalSparse,
    SEED.externalApptYesterday,
    SEED.externalApptCompleted,
  ]),
  clinics: new Set([CLINIC_A.id, CLINIC_B.id]),
  clinic_onboarding_requests: new Set([SEED.onboardingPending, SEED.onboardingPendingSparse]),
  doctors: new Set([SEED.doctorSparse]),
  external_staff: new Set([SEED.externalStaffSparse]),
  package_templates: new Set([SEED.packageTemplate]),
  packages: new Set([SEED.packageAsha, SEED.packageSparse, SEED.packageClinicB]),
  patients: new Set([
    SEED.patientAsha,
    SEED.patientRavi,
    SEED.patientClinicB,
    SEED.patientPaymentDue,
    SEED.patientExternal,
    SEED.patientSparse,
    SEED.patientReferredByDoctor,
    SEED.patientExternalSparse,
  ]),
  payments: new Set([SEED.paymentAsha, SEED.paymentSparse]),
  reminders: new Set([SEED.reminderSparse]),
  session_notes: new Set([SEED.sessionNoteSparse]),
  treatment_plans: new Set([SEED.treatmentPlanSparse]),
  user_invites: new Set([SEED.inviteMobileOnly, SEED.inviteLegacy, SEED.inviteRevoked]),
}

const protectedAuthEmails = new Set(ALL_ACCOUNTS.map(({ email }) => email.trim().toLowerCase()))

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 32)
}

function uniqueRunToken(testInfo: TestInfo): string {
  return [
    safeSlug(testInfo.project.name),
    `w${testInfo.workerIndex}`,
    `r${testInfo.retry}`,
    randomUUID().slice(0, 8),
  ].join('-')
}

/**
 * Per-test data builder. Every inserted UUID is tracked and cleanup deletes only those UUIDs;
 * fixed baseline rows from support/ids.ts are never registered or changed.
 */
export class E2EFactory {
  readonly token: string
  private readonly db: SupabaseClient
  private sequence = 0
  private readonly created = new Map<CleanupTable, Set<string>>()
  private readonly watchedPatientNames = new Set<string>()
  private readonly watchedAppointments = new Map<string, { patientId: string; notes: string }>()
  private readonly watchedSessionNoteAppointments = new Set<string>()
  private readonly watchedPayments = new Map<string, { patientId: string; notes: string }>()
  private readonly watchedPackages = new Map<string, { patientId: string; name: string }>()
  private readonly watchedAppointmentTypeNames = new Set<string>()
  private readonly watchedPackageTemplateNames = new Set<string>()
  private readonly watchedExternalStaff = new Map<string, { name: string; phone: string }>()
  private readonly watchedInviteEmails = new Set<string>()
  private readonly watchedInviteMobiles = new Set<string>()
  private readonly watchedReminderTitles = new Set<string>()
  private readonly watchedOnboardingRequests = new Map<string, { ownerEmail: string; clinicName: string }>()
  private readonly authUsers = new Map<string, string>()
  /** createAuthUser({ email: null }) users, by mobile; cleanup tags them before deleting. */
  private readonly emailLessAuthUsers = new Map<string, string>()
  private adminSession: SupabaseClient | null = null

  constructor(testInfo: TestInfo, db: SupabaseClient = adminClient()) {
    this.token = uniqueRunToken(testInfo)
    this.db = db
  }

  uniqueName(kind: string): string {
    this.sequence += 1
    return `E2E ${this.token} ${kind} ${this.sequence}`
  }

  uniqueEmail(kind: string): string {
    return `${safeSlug(kind)}-${this.token}-${randomUUID().slice(0, 8)}@carebook.test`
  }

  uniqueMobile(): string {
    const digits = Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 12), 16) % 1_000_000_000
    return `9${digits.toString().padStart(9, '0')}`
  }

  private async insert(table: CleanupTable, values: Row): Promise<Row> {
    const { data, error } = await this.db.from(table).insert(values).select('*').single()
    if (error || !data) {
      throw new Error(`factory insert ${table}: ${error?.message ?? 'row was not returned'}`)
    }
    const row = data as Row
    this.track(table, row.id)
    return row
  }

  private async insertMany(table: CleanupTable, values: Row[]): Promise<Row[]> {
    if (values.length === 0) return []
    // Track first: a partial failure must still be cleaned up.
    for (const row of values) this.track(table, row.id)
    const { data, error } = await this.db.from(table).insert(values).select('*')
    if (error || !data) {
      throw new Error(`factory insert ${values.length} ${table}: ${error?.message ?? 'rows were not returned'}`)
    }
    const byId = new Map((data as Row[]).map((row) => [row.id, row]))
    return values.map((row) => byId.get(row.id)!)
  }

  private isProtected(table: CleanupTable, id: string): boolean {
    return protectedIdsByTable[table]?.has(id) ?? false
  }

  /** An authenticated session as the Clinic A admin, for RPCs that require a real clinic admin. */
  private async asAdmin(): Promise<SupabaseClient> {
    if (this.adminSession) return this.adminSession
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await client.auth.signInWithPassword({ email: ADMIN.email, password: PASSWORD })
    if (error) throw new Error(`factory admin sign-in: ${error.message}`)
    this.adminSession = client
    return client
  }

  private track(table: CleanupTable, id: string): void {
    if (protectedIdsByTable[table]?.has(id)) return
    const ids = this.created.get(table) ?? new Set<string>()
    ids.add(id)
    this.created.set(table, ids)
  }

  trackPatient(id: string): void {
    this.track('patients', id)
  }

  trackAppointment(id: string): void {
    this.track('appointments', id)
  }

  trackSessionNote(id: string): void {
    this.track('session_notes', id)
  }

  trackOnboardingRequest(id: string): void {
    this.track('clinic_onboarding_requests', id)
  }

  trackProfile(id: string, email: string): void {
    if (protectedAuthEmails.has(email.trim().toLowerCase())) return
    this.track('profiles', id)
  }

  trackClinic(id: string): void {
    this.track('clinics', id)
  }

  trackAuthUser(id: string, email: string): void {
    const normalizedEmail = email.trim().toLowerCase()
    if (protectedAuthEmails.has(normalizedEmail)) return
    this.authUsers.set(id, normalizedEmail)
  }

  /** Register exact UI values before submit so teardown can recover rows after partial failures. */
  watchUiPatient(name: string): void {
    this.watchedPatientNames.add(name)
  }

  /** Appointment notes are unique per test and paired with the factory-owned patient. */
  watchUiAppointments(input: { patientId: string; notes: string }): void {
    this.watchedAppointments.set(`${input.patientId}\u0000${input.notes}`, input)
  }

  /** Reminder titles are unique per test; teardown deletes the clinic's reminders with them. */
  watchUiReminder(title: string): void {
    this.watchedReminderTitles.add(title)
  }

  watchUiSessionNote(appointmentId: string): void {
    this.watchedSessionNoteAppointments.add(appointmentId)
  }

  watchUiPayment(input: { patientId: string; notes: string }): void {
    this.watchedPayments.set(`${input.patientId}\u0000${input.notes}`, input)
  }

  watchUiPackage(input: { patientId: string; name: string }): void {
    this.watchedPackages.set(`${input.patientId}\u0000${input.name}`, input)
  }

  watchUiAppointmentType(name: string): void {
    this.watchedAppointmentTypeNames.add(name)
  }

  watchUiPackageTemplate(name: string): void {
    this.watchedPackageTemplateNames.add(name)
  }

  watchUiExternalStaff(input: { name: string; phone: string }): void {
    this.watchedExternalStaff.set(`${input.name}\u0000${input.phone}`, input)
  }

  /** Tracks both the exact invite row and the exact local auth user created for that email. */
  watchUiInvite(email: string): void {
    this.watchedInviteEmails.add(email.trim().toLowerCase())
  }

  /**
   * Same as watchUiInvite for an invite made with no email (mobile-number sign-in). Teardown
   * gives that exact auth user a disposable `@carebook.test` address first, because the
   * soft-delete guard (033) only lets cleanup hard-delete E2E identities it can recognise.
   */
  watchUiMobileInvite(mobileNumber: string): void {
    this.watchedInviteMobiles.add(mobileNumber)
  }

  watchUiOnboardingRequest(input: { ownerEmail: string; clinicName: string }): void {
    const ownerEmail = input.ownerEmail.trim().toLowerCase()
    this.watchedOnboardingRequests.set(`${ownerEmail}\u0000${input.clinicName}`, {
      ownerEmail,
      clinicName: input.clinicName,
    })
  }

  async findPatientByName(name: string): Promise<E2EPatientRow | null> {
    const { data, error } = await this.db
      .from('patients')
      .select('*')
      .eq('clinic_id', CLINIC_A.id)
      .eq('name', name)
      .maybeSingle()
    if (error) throw new Error(`factory find patient: ${error.message}`)
    if (data) this.trackPatient(data.id)
    return data as E2EPatientRow | null
  }

  async findAppointments(input: {
    patientId: string
    notes?: string
    date?: string
    time?: string
  }): Promise<E2EAppointmentRow[]> {
    let query = this.db
      .from('appointments')
      .select('*')
      .eq('clinic_id', CLINIC_A.id)
      .eq('patient_id', input.patientId)
    if (input.notes !== undefined) query = query.eq('notes', input.notes)
    if (input.date !== undefined) query = query.eq('date', input.date)
    if (input.time !== undefined) query = query.eq('time', input.time)
    const { data, error } = await query.order('date').order('time')
    if (error) throw new Error(`factory find appointments: ${error.message}`)
    for (const row of data ?? []) this.trackAppointment(row.id)
    return (data ?? []) as E2EAppointmentRow[]
  }

  async findSessionNoteByAppointmentId(appointmentId: string): Promise<E2ESessionNoteRow | null> {
    const { data, error } = await this.db
      .from('session_notes')
      .select('*')
      .eq('appointment_id', appointmentId)
      .maybeSingle()
    if (error) throw new Error(`factory find session note: ${error.message}`)
    if (data) this.trackSessionNote(data.id)
    return data as E2ESessionNoteRow | null
  }

  /** Every payment on a factory patient, for receipts saved without notes to match on. */
  async findPayments(input: { patientId: string }): Promise<E2EPaymentRow[]> {
    const { data, error } = await this.db
      .from('payments')
      .select('*')
      .eq('clinic_id', CLINIC_A.id)
      .eq('patient_id', input.patientId)
    if (error) throw new Error(`factory find payments: ${error.message}`)
    for (const row of data ?? []) this.track('payments', row.id)
    return (data ?? []) as E2EPaymentRow[]
  }

  async findPayment(input: { patientId: string; notes: string }): Promise<E2EPaymentRow | null> {
    const { data, error } = await this.db
      .from('payments')
      .select('*')
      .eq('clinic_id', CLINIC_A.id)
      .eq('patient_id', input.patientId)
      .eq('notes', input.notes)
      .maybeSingle()
    if (error) throw new Error(`factory find payment: ${error.message}`)
    if (data) this.track('payments', data.id)
    return data as E2EPaymentRow | null
  }

  async findPackage(input: { patientId: string; name: string }): Promise<E2EPackageRow | null> {
    const { data, error } = await this.db
      .from('packages')
      .select('*')
      .eq('clinic_id', CLINIC_A.id)
      .eq('patient_id', input.patientId)
      .eq('name', input.name)
      .maybeSingle()
    if (error) throw new Error(`factory find package: ${error.message}`)
    if (data) this.track('packages', data.id)
    return data as E2EPackageRow | null
  }

  async findAppointmentTypeByName(name: string): Promise<E2EAppointmentTypeRow | null> {
    const { data, error } = await this.db
      .from('appointment_types')
      .select('*')
      .eq('clinic_id', CLINIC_A.id)
      .eq('name', name)
      .maybeSingle()
    if (error) throw new Error(`factory find appointment type by name: ${error.message}`)
    if (data) this.track('appointment_types', data.id)
    return data as E2EAppointmentTypeRow | null
  }

  async findPackageTemplateByName(name: string): Promise<E2EPackageTemplateRow | null> {
    const { data, error } = await this.db
      .from('package_templates')
      .select('*')
      .eq('clinic_id', CLINIC_A.id)
      .eq('name', name)
      .maybeSingle()
    if (error) throw new Error(`factory find package template: ${error.message}`)
    if (data) this.track('package_templates', data.id)
    return data as E2EPackageTemplateRow | null
  }

  async findExternalStaff(input: { name: string; phone: string }): Promise<E2EExternalStaffRow | null> {
    const { data, error } = await this.db
      .from('external_staff')
      .select('*')
      .eq('clinic_id', CLINIC_A.id)
      .eq('name', input.name)
      .eq('phone', input.phone)
      .maybeSingle()
    if (error) throw new Error(`factory find external staff: ${error.message}`)
    if (data) this.track('external_staff', data.id)
    return data as E2EExternalStaffRow | null
  }

  async findInviteByMobile(mobileNumber: string): Promise<E2EUserInviteRow | null> {
    const { data, error } = await this.db
      .from('user_invites')
      .select('*')
      .eq('clinic_id', CLINIC_A.id)
      .eq('mobile_number', mobileNumber)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`factory find invite by mobile: ${error.message}`)
    if (data) this.track('user_invites', data.id)
    return data as E2EUserInviteRow | null
  }

  async findInviteByEmail(email: string): Promise<E2EUserInviteRow | null> {
    const normalizedEmail = email.trim().toLowerCase()
    const { data, error } = await this.db
      .from('user_invites')
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle()
    if (error) throw new Error(`factory find invite: ${error.message}`)
    if (data) this.track('user_invites', data.id)
    return data as E2EUserInviteRow | null
  }

  async findRefunds(input: { paymentId?: string; patientId?: string }): Promise<E2ERefundRow[]> {
    if (!input.paymentId && !input.patientId) throw new Error('findRefunds needs paymentId or patientId')
    let query = this.db.from('refunds').select('*').eq('clinic_id', CLINIC_A.id)
    if (input.paymentId) query = query.eq('payment_id', input.paymentId)
    if (input.patientId) query = query.eq('patient_id', input.patientId)
    const { data, error } = await query.order('created_at')
    if (error) throw new Error(`factory find refunds: ${error.message}`)
    return (data ?? []) as E2ERefundRow[]
  }

  async findChargeAdjustments(input: { appointmentId?: string; patientId?: string }): Promise<E2EChargeAdjustmentRow[]> {
    if (!input.appointmentId && !input.patientId) throw new Error('findChargeAdjustments needs appointmentId or patientId')
    let query = this.db.from('appointment_charge_adjustments').select('*').eq('clinic_id', CLINIC_A.id)
    if (input.appointmentId) query = query.eq('appointment_id', input.appointmentId)
    if (input.patientId) query = query.eq('patient_id', input.patientId)
    const { data, error } = await query.order('created_at')
    if (error) throw new Error(`factory find charge adjustments: ${error.message}`)
    return (data ?? []) as E2EChargeAdjustmentRow[]
  }

  /** Every note on an appointment, oldest first: there is no uniqueness on appointment_id (G-4). */
  async findSessionNotes(appointmentId: string): Promise<E2ESessionNoteRow[]> {
    const { data, error } = await this.db
      .from('session_notes').select('*').eq('appointment_id', appointmentId).order('created_at')
    if (error) throw new Error(`factory find session notes: ${error.message}`)
    for (const row of data ?? []) this.trackSessionNote(row.id)
    return (data ?? []) as E2ESessionNoteRow[]
  }

  async findReminders(input: { title?: string; patientId?: string; date?: string }): Promise<E2EReminderRow[]> {
    let query = this.db.from('reminders').select('*').eq('clinic_id', CLINIC_A.id)
    if (input.title !== undefined) query = query.eq('title', input.title)
    if (input.patientId !== undefined) query = query.eq('patient_id', input.patientId)
    if (input.date !== undefined) query = query.eq('date', input.date)
    const { data, error } = await query.order('created_at')
    if (error) throw new Error(`factory find reminders: ${error.message}`)
    for (const row of data ?? []) this.track('reminders', row.id)
    return (data ?? []) as E2EReminderRow[]
  }

  async findTreatmentPlans(patientId: string): Promise<E2ETreatmentPlanRow[]> {
    const { data, error } = await this.db
      .from('treatment_plans').select('*').eq('patient_id', patientId).order('created_at')
    if (error) throw new Error(`factory find treatment plans: ${error.message}`)
    for (const row of data ?? []) this.track('treatment_plans', row.id)
    return (data ?? []) as E2ETreatmentPlanRow[]
  }

  /** Clinic A doctors whose name matches case-insensitively (the table is unique on lower(name)). */
  async findDoctors(input: { name: string }): Promise<E2EDoctorRow[]> {
    const { data, error } = await this.db
      .from('doctors').select('*').eq('clinic_id', CLINIC_A.id).ilike('name', input.name.trim())
    if (error) throw new Error(`factory find doctors: ${error.message}`)
    for (const row of data ?? []) this.track('doctors', row.id)
    return (data ?? []) as E2EDoctorRow[]
  }

  /**
   * Remove a factory patient and everything hanging off it right now, e.g. while its edit form is
   * open in the browser (G-3). Uses the same cleanup RPC as teardown; fixed SEED patients and
   * non-`E2E …` names are refused.
   */
  async deletePatientHard(patientId: string): Promise<void> {
    if (this.isProtected('patients', patientId)) throw new Error(`factory deletePatientHard: ${patientId} is a fixed SEED patient`)
    const { error } = await this.db.rpc('cleanup_e2e_patient', { target_patient_id: patientId })
    if (error) throw new Error(`factory delete patient: ${error.message}`)
  }

  /** Delete one factory appointment row (and its notes and payment links) behind the UI's back. */
  async deleteAppointmentHard(appointmentId: string): Promise<void> {
    if (this.isProtected('appointments', appointmentId)) {
      throw new Error(`factory deleteAppointmentHard: ${appointmentId} is a fixed SEED appointment`)
    }
    for (const [table, column] of [['session_notes', 'appointment_id'], ['appointment_payments', 'appointment_id']] as const) {
      const { error } = await this.db.from(table).delete().eq(column, appointmentId)
      if (error) throw new Error(`factory delete appointment ${table}: ${error.message}`)
    }
    const { error } = await this.db.from('appointments').delete().eq('id', appointmentId)
    if (error) throw new Error(`factory delete appointment: ${error.message}`)
  }

  async getGlobalSettings(): Promise<E2EGlobalSettingsRow> {
    const { data, error } = await this.db
      .from('global_settings')
      .select('id, clinic_id, clinic_fee, home_visit_fee')
      .eq('clinic_id', CLINIC_A.id)
      .single()
    if (error || !data) {
      throw new Error(`factory get global settings: ${error?.message ?? 'row was not returned'}`)
    }
    return data as E2EGlobalSettingsRow
  }

  async restoreGlobalSettings(settings: E2EGlobalSettingsRow): Promise<void> {
    const { error } = await this.db
      .from('global_settings')
      .update({
        clinic_fee: settings.clinic_fee,
        home_visit_fee: settings.home_visit_fee,
      })
      .eq('id', settings.id)
      .eq('clinic_id', settings.clinic_id)
    if (error) throw new Error(`factory restore global settings: ${error.message}`)
  }

  async findClinicById(id: string): Promise<E2EClinicRow | null> {
    const { data, error } = await this.db.from('clinics').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(`factory find clinic: ${error.message}`)
    return data as E2EClinicRow | null
  }

  async findOnboardingRequestByEmail(email: string): Promise<E2EOnboardingRequestRow | null> {
    const normalizedEmail = email.trim().toLowerCase()
    const { data, error } = await this.db
      .from('clinic_onboarding_requests')
      .select('*')
      .eq('owner_email', normalizedEmail)
      .maybeSingle()
    if (error) throw new Error(`factory find onboarding request: ${error.message}`)
    return data as E2EOnboardingRequestRow | null
  }

  async findProfileById(id: string): Promise<E2EProfileRow | null> {
    const { data, error } = await this.db.from('profiles').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(`factory find profile by id: ${error.message}`)
    return data as E2EProfileRow | null
  }

  async getAuthUser(id: string) {
    const { data, error } = await this.db.auth.admin.getUserById(id)
    if (error || !data.user) throw new Error(`factory get auth user: ${error?.message ?? 'missing'}`)
    return data.user
  }

  async findAppointmentType(isShared: boolean): Promise<E2EAppointmentTypeRow> {
    const { data, error } = await this.db
      .from('appointment_types')
      .select('id, name, is_shared, session_rate')
      .eq('clinic_id', CLINIC_A.id)
      .eq('is_shared', isShared)
      .order('sort_order')
      .limit(1)
      .single()
    if (error || !data) throw new Error(`factory find appointment type: ${error?.message ?? 'missing'}`)
    return data as E2EAppointmentTypeRow
  }

  async findProfileByEmail(email: string): Promise<E2EProfileRow> {
    const { data, error } = await this.db
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('clinic_id', CLINIC_A.id)
      .eq('email', email)
      .single()
    if (error || !data) throw new Error(`factory find profile: ${error?.message ?? 'missing'}`)
    return data as E2EProfileRow
  }

  /**
   * A Clinic A patient with a unique `E2E …` name and a phone. Override any column; pass `null` to
   * leave it blank (`{ phone: null }`). Legacy shapes are allowed: `{ dob: '1990-03-10' }`, a
   * referral (`{ referral_source: 'doctor', referred_by_doctor_id: doctor.id }`) or a dangling one
   * (`{ referral_source: 'patient', referred_by_patient_id: null }`).
   */
  async createPatient(overrides: E2EPatientInput = {}): Promise<E2EPatientRow> {
    return this.insert('patients', {
      id: randomUUID(),
      clinic_id: CLINIC_A.id,
      name: this.uniqueName('patient'),
      phone: `9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`,
      ...overrides,
    }) as Promise<E2EPatientRow>
  }

  /** `count` patients in one insert; `overrides(i)` customises each (names stay unique). */
  async createPatients(
    count: number,
    overrides: E2EPatientInput | ((index: number) => E2EPatientInput) = {},
  ): Promise<E2EPatientRow[]> {
    const rows = Array.from({ length: count }, (_, index) => ({
      id: randomUUID(),
      clinic_id: CLINIC_A.id,
      name: this.uniqueName('patient'),
      phone: this.uniqueMobile(),
      ...(typeof overrides === 'function' ? overrides(index) : overrides),
    }))
    return this.insertMany('patients', rows) as Promise<E2EPatientRow[]>
  }

  /**
   * A scheduled shared-type appointment today at 15:00 with fee 800 and unique notes. Pass
   * `fee: null` (legacy row with no fee), `notes: null`, `status`, `date`, `time`, `assigned_to`…
   */
  async createAppointment({
    patientId,
    appointmentTypeId,
    ...overrides
  }: {
    patientId: string
    appointmentTypeId?: string
    fee?: number | null
    notes?: string | null
    [key: string]: unknown
  }): Promise<E2EAppointmentRow> {
    let typeId = appointmentTypeId
    if (!typeId) {
      const { data, error } = await this.db
        .from('appointment_types')
        .select('id')
        .eq('clinic_id', CLINIC_A.id)
        .eq('is_shared', true)
        .order('sort_order')
        .limit(1)
        .single()
      if (error || !data) throw new Error(`factory appointment type: ${error?.message ?? 'missing'}`)
      typeId = data.id
    }

    return this.insert('appointments', {
      id: randomUUID(),
      clinic_id: CLINIC_A.id,
      patient_id: patientId,
      appointment_type_id: typeId,
      type: 'Clinic',
      date: clinicDate(),
      time: '15:00',
      fee: 800,
      status: 'scheduled',
      payment_status: 'unpaid',
      notes: this.uniqueName('appointment'),
      ...overrides,
    }) as Promise<E2EAppointmentRow>
  }

  /**
   * Drives an appointment through a real status change so the billing reconciliation runs, which is
   * how one session ends up with both a released and a replacement package allocation.
   */
  async updateAppointment(id: string, values: Record<string, unknown>): Promise<Row> {
    const { data, error } = await this.db.from('appointments').update(values).eq('id', id).select('*').single()
    if (error || !data) throw new Error(`factory update appointment: ${error?.message ?? 'row was not returned'}`)
    return data as Row
  }

  async createPackage({
    patientId,
    appointmentTypeId,
    ...overrides
  }: {
    patientId: string
    appointmentTypeId?: string
    [key: string]: unknown
  }): Promise<Row> {
    let typeId = appointmentTypeId
    if (!typeId) {
      const { data, error } = await this.db.from('appointment_types').select('id').eq('clinic_id', CLINIC_A.id).eq('is_shared', true).order('sort_order').limit(1).single()
      if (error || !data) throw new Error(`factory package appointment type: ${error?.message ?? 'missing'}`)
      typeId = data.id
    }
    return this.insert('packages', {
      id: randomUUID(),
      clinic_id: CLINIC_A.id,
      patient_id: patientId,
      name: this.uniqueName('package'),
      total_sessions: 4,
      used_sessions: 0,
      total_amount: 3000,
      per_session_amount: 750,
      paid_amount: 3000,
      payment_timing: 'prepaid',
      status: 'active',
      appointment_type_id: typeId,
      starts_on: clinicDate(-365),
      billing_version: 2,
      ...overrides,
    })
  }

  async createPayment({
    patientId,
    ...overrides
  }: {
    patientId: string
    [key: string]: unknown
  }): Promise<Row> {
    const packageId = typeof overrides.package_id === 'string' ? overrides.package_id : null
    return this.insert('payments', {
      id: randomUUID(),
      clinic_id: CLINIC_A.id,
      patient_id: patientId,
      amount: 750,
      payment_method: 'UPI',
      date: clinicDate(),
      notes: this.uniqueName('payment'),
      package_id: packageId,
      funding_scope: packageId ? 'package' : 'ordinary',
      status: 'posted',
      billing_version: 2,
      ...overrides,
    })
  }

  /**
   * `count` payments for one patient in one insert, on distinct dates (today, yesterday, …
   * counting back from `startDayOffset`) with unique notes, e.g. for "Load more" paging.
   */
  async createPayments(
    count: number,
    { patientId, startDayOffset = 0, ...overrides }: { patientId: string; startDayOffset?: number; [key: string]: unknown },
  ): Promise<E2EPaymentRow[]> {
    const rows = Array.from({ length: count }, (_, index) => ({
      id: randomUUID(),
      clinic_id: CLINIC_A.id,
      patient_id: patientId,
      amount: 750,
      payment_method: 'UPI',
      date: clinicDate(startDayOffset - index),
      notes: this.uniqueName('payment'),
      package_id: null,
      funding_scope: 'ordinary',
      status: 'posted',
      billing_version: 2,
      ...overrides,
    }))
    return this.insertMany('payments', rows) as Promise<E2EPaymentRow[]>
  }

  /** `count` active prepaid packages for one patient in one insert, each with a unique name. */
  async createPackages(
    count: number,
    { patientId, appointmentTypeId, ...overrides }: { patientId: string; appointmentTypeId?: string; [key: string]: unknown },
  ): Promise<E2EPackageRow[]> {
    const typeId = appointmentTypeId ?? (await this.findAppointmentType(true)).id
    const rows = Array.from({ length: count }, () => ({
      id: randomUUID(),
      clinic_id: CLINIC_A.id,
      patient_id: patientId,
      name: this.uniqueName('package'),
      total_sessions: 4,
      used_sessions: 0,
      total_amount: 3000,
      per_session_amount: 750,
      paid_amount: 0,
      payment_timing: 'prepaid',
      status: 'active',
      appointment_type_id: typeId,
      starts_on: clinicDate(-365),
      billing_version: 2,
      ...overrides,
    }))
    return this.insertMany('packages', rows) as Promise<E2EPackageRow[]>
  }

  /**
   * Refund part of a payment through the real `record_refund` RPC as the Clinic A admin, so the
   * ledger checks (amount within what is left, a reason) apply. Refunds are immutable; teardown
   * removes them with their disposable `E2E …` patient (cleanup_e2e_patient), so only refund a
   * factory patient's payment.
   */
  async createRefund(input: {
    paymentId: string
    amount: number
    reason?: string
    method?: 'cash' | 'upi' | 'card' | 'bank_transfer'
    date?: string
  }): Promise<E2ERefundRow> {
    const { data: payment, error: paymentError } = await this.db
      .from('payments').select('patient_id').eq('id', input.paymentId).single()
    if (paymentError || !payment) throw new Error(`factory refund payment: ${paymentError?.message ?? 'missing'}`)
    if (!this.created.get('patients')?.has(payment.patient_id)) {
      throw new Error('factory createRefund: refund only payments of factory-owned patients (refunds are immutable)')
    }
    const admin = await this.asAdmin()
    const { error } = await admin.rpc('record_refund', {
      p_payment_id: input.paymentId,
      p_amount: input.amount,
      p_refund_method: input.method ?? 'upi',
      p_refund_date: input.date ?? clinicDate(),
      p_reason: input.reason ?? this.uniqueName('refund-reason'),
    })
    if (error) throw new Error(`factory record_refund: ${error.message}`)
    const refunds = await this.findRefunds({ paymentId: input.paymentId })
    const refund = refunds.at(-1)
    if (!refund) throw new Error('factory record_refund: no refund row was written')
    return refund
  }

  /** A Temporary Staff row (no login). `email` and `notes` stay NULL unless passed. */
  async createExternalStaff(overrides: Record<string, unknown> = {}): Promise<E2EExternalStaffRow> {
    return this.insert('external_staff', {
      id: randomUUID(),
      clinic_id: CLINIC_A.id,
      name: this.uniqueName('temp-staff'),
      phone: this.uniqueMobile(),
      email: null,
      notes: null,
      status: 'active',
      ...overrides,
    }) as Promise<E2EExternalStaffRow>
  }

  /** A pending Clinic A reminder dated today with only a title; pass time/phone/notes/patient_id… */
  async createReminder(overrides: Record<string, unknown> = {}): Promise<E2EReminderRow> {
    return this.insert('reminders', {
      id: randomUUID(),
      clinic_id: CLINIC_A.id,
      title: this.uniqueName('reminder'),
      date: clinicDate(),
      status: 'pending',
      ...overrides,
    }) as Promise<E2EReminderRow>
  }

  /** A SOAP note with every field NULL unless passed. No uniqueness on appointment_id (G-4). */
  async createSessionNote({ appointmentId, ...overrides }: { appointmentId: string; [key: string]: unknown }): Promise<E2ESessionNoteRow> {
    return this.insert('session_notes', {
      id: randomUUID(),
      appointment_id: appointmentId,
      subjective: null,
      objective: null,
      assessment: null,
      plan: null,
      exercises_prescribed: null,
      ...overrides,
    }) as Promise<E2ESessionNoteRow>
  }

  /** An active plan with a unique diagnosis starting today; goals and expected end stay NULL. */
  async createTreatmentPlan({ patientId, ...overrides }: { patientId: string; [key: string]: unknown }): Promise<E2ETreatmentPlanRow> {
    return this.insert('treatment_plans', {
      id: randomUUID(),
      clinic_id: CLINIC_A.id,
      patient_id: patientId,
      diagnosis: this.uniqueName('diagnosis'),
      start_date: clinicDate(),
      goals: null,
      expected_end_date: null,
      status: 'active',
      ...overrides,
    }) as Promise<E2ETreatmentPlanRow>
  }

  /** A referring doctor with a unique name; specialty and address stay NULL unless passed. */
  async createDoctor(overrides: Record<string, unknown> = {}): Promise<E2EDoctorRow> {
    return this.insert('doctors', {
      id: randomUUID(),
      clinic_id: CLINIC_A.id,
      name: this.uniqueName('doctor'),
      specialty: null,
      address: null,
      ...overrides,
    }) as Promise<E2EDoctorRow>
  }

  /**
   * Replace a factory patient's External Staff grants (the same RPC the admin's "Save access"
   * uses). Teardown drops the grants and their audit rows with the patient. Fixed SEED patients
   * are refused: replacing their grants would change the baseline for every other spec.
   */
  async shareWithExternal(patientId: string, profileIds: readonly string[]): Promise<void> {
    if (this.isProtected('patients', patientId)) {
      throw new Error(`factory shareWithExternal: ${patientId} is a fixed SEED patient`)
    }
    const admin = await this.asAdmin()
    const { error } = await admin.rpc('replace_patient_external_access', {
      p_patient_id: patientId, p_profile_ids: [...profileIds],
    })
    if (error) throw new Error(`factory share with external: ${error.message}`)
  }

  /**
   * Book the way External Staff do: signed in as them, through `external_create_appointment`.
   * Defaults to the seeded EXTERNAL account; pass `as` for a factory-made external user. The
   * patient must already be shared with that account (shareWithExternal).
   */
  async createExternalBooking(input: {
    patientId: string
    date: string
    time: string
    durationMinutes?: number
    appointmentTypeId?: string
    as?: { email?: string | null; mobileNumber?: string; password?: string }
  }): Promise<E2EAppointmentRow> {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const password = input.as?.password ?? PASSWORD
    const login = input.as?.email
      ? await client.auth.signInWithPassword({ email: input.as.email, password })
      : input.as?.mobileNumber
        ? await client.auth.signInWithPassword({ phone: input.as.mobileNumber, password })
        : await client.auth.signInWithPassword({ email: EXTERNAL.email, password: PASSWORD })
    if (login.error) throw new Error(`factory external sign-in: ${login.error.message}`)
    try {
      const { data, error } = await client.rpc('external_create_appointment', {
        p_request: {
          id: randomUUID(),
          patient_id: input.patientId,
          appointment_type_id: input.appointmentTypeId ?? (await this.findAppointmentType(true)).id,
          date: input.date,
          time: input.time,
          duration_minutes: input.durationMinutes ?? 45,
        },
      })
      if (error || !data) throw new Error(`factory external booking: ${error?.message ?? 'no result'}`)
      const id = (data as { id: string }).id
      this.trackAppointment(id)
      const { data: row, error: rowError } = await this.db.from('appointments').select('*').eq('id', id).single()
      if (rowError || !row) throw new Error(`factory external booking row: ${rowError?.message ?? 'missing'}`)
      return row as E2EAppointmentRow
    } finally {
      await client.auth.signOut({ scope: 'local' })
    }
  }

  async createPackageTemplate(overrides: Record<string, unknown> = {}): Promise<Row> {
    return this.insert('package_templates', {
      id: randomUUID(),
      clinic_id: CLINIC_A.id,
      name: this.uniqueName('package-template'),
      min_sessions: 4,
      per_session_amount: 750,
      ...overrides,
    })
  }

  async createAppointmentType(overrides: Record<string, unknown> = {}): Promise<Row> {
    return this.insert('appointment_types', {
      id: randomUUID(),
      clinic_id: CLINIC_A.id,
      name: this.uniqueName('appointment-type'),
      session_rate: 900,
      is_shared: false,
      is_default: false,
      sort_order: 1000 + this.sequence,
      ...overrides,
    })
  }

  /**
   * A pending clinic request with a unique owner email and mobile. Pass `ownerEmail` to collide
   * with an existing account or request on purpose; any column can be overridden
   * (`clinic_phone: null`).
   */
  async createOnboardingRequest(
    { ownerEmail, ...overrides }: { ownerEmail?: string; [key: string]: unknown } = {},
  ): Promise<E2EOnboardingRequestRow> {
    const suffix = randomUUID().slice(0, 8)
    return this.insert('clinic_onboarding_requests', {
      id: randomUUID(),
      clinic_name: this.uniqueName('clinic-request'),
      owner_full_name: this.uniqueName('request-owner'),
      owner_email: (ownerEmail ?? `${this.token}-${suffix}@carebook.test`).trim().toLowerCase(),
      owner_mobile_number: this.uniqueMobile(),
      status: 'pending',
      ...overrides,
    }) as Promise<E2EOnboardingRequestRow>
  }

  async createClinic(overrides: Record<string, unknown> = {}): Promise<E2EClinicRow> {
    return this.insert('clinics', {
      id: randomUUID(),
      name: this.uniqueName('clinic'),
      status: 'active',
      ...overrides,
    }) as Promise<E2EClinicRow>
  }

  /**
   * A signed-up user with a profile in `clinicId`. `email: null` makes a mobile-only account
   * (it signs in with `mobileNumber`); `fullName: null` leaves the profile nameless;
   * `role: 'external_staff'` makes an External Staff login; `status: 'blocked'` blocks the profile.
   */
  async createAuthUser(input: CreateAuthUserInput & { email: null }): Promise<E2EMobileOnlyAuthResource>
  async createAuthUser(input: CreateAuthUserInput & { email?: string }): Promise<E2EAuthResource>
  async createAuthUser(input: CreateAuthUserInput): Promise<E2EAuthResource | E2EMobileOnlyAuthResource> {
    const email = input.email === null ? null : (input.email ?? this.uniqueEmail('user')).trim().toLowerCase()
    const password = input.password ?? PASSWORD
    const mobileNumber = input.mobileNumber ?? this.uniqueMobile()
    const { data, error } = await this.db.auth.admin.createUser({
      ...(email ? { email, email_confirm: true } : {}),
      phone: mobileNumber,
      phone_confirm: true,
      password,
    })
    if (error || !data.user) {
      throw new Error(`factory create auth user: ${error?.message ?? 'user was not returned'}`)
    }
    if (email) {
      this.trackAuthUser(data.user.id, email)
      this.trackProfile(data.user.id, email)
    } else {
      // Tagged with a disposable address at teardown; until then track the profile by id only.
      this.emailLessAuthUsers.set(data.user.id, mobileNumber)
      this.track('profiles', data.user.id)
    }

    const { data: profile, error: profileError } = await this.db
      .from('profiles')
      .update({
        clinic_id: input.clinicId,
        email,
        role: input.role ?? 'staff',
        full_name: input.fullName === null ? null : (input.fullName ?? this.uniqueName('user')),
        mobile_number: mobileNumber,
        status: input.status ?? 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.user.id)
      .select('*')
      .single()
    if (profileError || !profile) {
      throw new Error(`factory update auth profile: ${profileError?.message ?? 'profile was not returned'}`)
    }

    return email
      ? { id: data.user.id, email, mobileNumber, password, profile: profile as E2EProfileRow }
      : { id: data.user.id, email: null, mobileNumber, password, profile: profile as E2EMobileOnlyAuthResource['profile'] }
  }

  /**
   * A pending invite row. `email: null` is a mobile-only invite; `fullName: null` and
   * `mobileNumber: null` give the legacy (pre-mobile) shape. The table requires an email or a
   * mobile number.
   */
  async createUserInvite(input: {
    clinicId: string
    /** Null for a mobile-only invite, which mobile-number sign-in allows. */
    email: string | null
    authUserId?: string | null
    invitedBy?: string
    role?: 'admin' | 'staff' | 'external_staff'
    fullName?: string | null
    mobileNumber?: string | null
    status?: 'pending' | 'accepted' | 'revoked'
  }): Promise<E2EUserInviteRow> {
    const invitedBy = input.invitedBy ?? await this.findAuthUserIdByEmail(ADMIN.email)
    const status = input.status ?? 'pending'
    return this.insert('user_invites', {
      id: randomUUID(),
      clinic_id: input.clinicId,
      email: input.email?.trim().toLowerCase() ?? null,
      role: input.role ?? 'staff',
      status,
      auth_user_id: input.authUserId ?? null,
      invited_by: invitedBy,
      full_name: input.fullName === null ? null : (input.fullName ?? this.uniqueName('invitee')),
      mobile_number: input.mobileNumber === null ? null : (input.mobileNumber ?? this.uniqueMobile()),
      revoked_at: status === 'revoked' ? new Date().toISOString() : null,
      accepted_at: status === 'accepted' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }) as Promise<E2EUserInviteRow>
  }

  async createInviteAction(input: {
    clinicId: string
    email?: string
    role?: 'admin' | 'staff'
    fullName?: string
    mobileNumber?: string
  }) {
    const clinicId = input.clinicId
    const email = (input.email ?? this.uniqueEmail('invite')).trim().toLowerCase()
    const role = input.role ?? 'staff'
    const redirectTo = 'http://localhost:3000/auth/callback?next=%2Fauth%2Fcomplete-invite'
    const link = await generateLocalInviteLink(this.db, {
      email,
      redirectTo,
      data: { role, clinic_id: clinicId },
    })
    this.trackAuthUser(link.authUserId, email)
    this.trackProfile(link.authUserId, email)
    const invite = await this.createUserInvite({
      clinicId,
      email,
      authUserId: link.authUserId,
      role,
      fullName: input.fullName,
      mobileNumber: input.mobileNumber,
    })
    return { ...link, email, invite }
  }

  async createRecoveryAction(email: string) {
    return generateLocalRecoveryLink(this.db, {
      email: email.trim().toLowerCase(),
      redirectTo: 'http://localhost:3000/auth/callback?next=%2Fauth%2Fupdate-password',
    })
  }

  private async findAuthUserIdByEmail(email: string): Promise<string> {
    const normalizedEmail = email.trim().toLowerCase()
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await this.db.auth.admin.listUsers({ page, perPage: 200 })
      if (error) throw new Error(`factory list auth users: ${error.message}`)
      const found = data.users.find((user) => user.email?.toLowerCase() === normalizedEmail)
      if (found) return found.id
      if (data.users.length < 200) break
    }
    throw new Error(`factory auth user not found: ${normalizedEmail}`)
  }

  async cleanup(): Promise<void> {
    const failures: string[] = []
    const markedAuthUsers = new Set<string>()
    const markAuthUserForCleanup = async (id: string, email: string) => {
      if (markedAuthUsers.has(id)) return
      if (!email.endsWith('@carebook.test')) {
        failures.push(`refuse to hard-delete non-E2E auth user ${id} (${email})`)
        return
      }
      const { error } = await this.db.auth.admin.updateUserById(id, {
        app_metadata: {
          carebook_e2e_cleanup: {
            state: 'requested',
            reason: `Playwright cleanup ${this.token}`,
          },
        },
      })
      if (error) {
        failures.push(`mark auth user ${id} (${email}) for cleanup: ${error.message}`)
        return
      }
      markedAuthUsers.add(id)
    }

    for (const { ownerEmail, clinicName } of this.watchedOnboardingRequests.values()) {
      const { data, error } = await this.db
        .from('clinic_onboarding_requests')
        .select('id, clinic_id')
        .eq('owner_email', ownerEmail)
        .eq('clinic_name', clinicName)
      if (error) failures.push(`discover onboarding request ${ownerEmail}: ${error.message}`)
      for (const row of data ?? []) {
        this.trackOnboardingRequest(row.id)
        if (row.clinic_id) this.trackClinic(row.clinic_id)
      }
      const { data: clinics, error: clinicError } = await this.db
        .from('clinics')
        .select('id')
        .eq('name', clinicName)
      if (clinicError) failures.push(`discover approved clinic ${clinicName}: ${clinicError.message}`)
      for (const clinic of clinics ?? []) this.trackClinic(clinic.id)
    }
    for (const name of this.watchedPatientNames) {
      const { data, error } = await this.db
        .from('patients')
        .select('id')
        .eq('clinic_id', CLINIC_A.id)
        .eq('name', name)
      if (error) failures.push(`discover patient ${name}: ${error.message}`)
      for (const row of data ?? []) this.trackPatient(row.id)
    }
    for (const { patientId, notes } of this.watchedAppointments.values()) {
      const { data, error } = await this.db
        .from('appointments')
        .select('id')
        .eq('clinic_id', CLINIC_A.id)
        .eq('patient_id', patientId)
        .eq('notes', notes)
      if (error) failures.push(`discover appointments ${notes}: ${error.message}`)
      for (const row of data ?? []) this.trackAppointment(row.id)
    }
    for (const appointmentId of this.watchedSessionNoteAppointments) {
      const { data, error } = await this.db
        .from('session_notes')
        .select('id')
        .eq('appointment_id', appointmentId)
      if (error) failures.push(`discover session note ${appointmentId}: ${error.message}`)
      for (const row of data ?? []) this.trackSessionNote(row.id)
    }
    for (const { patientId, notes } of this.watchedPayments.values()) {
      const { data, error } = await this.db
        .from('payments')
        .select('id')
        .eq('clinic_id', CLINIC_A.id)
        .eq('patient_id', patientId)
        .eq('notes', notes)
      if (error) failures.push(`discover payment ${notes}: ${error.message}`)
      for (const row of data ?? []) this.track('payments', row.id)
    }
    for (const { patientId, name } of this.watchedPackages.values()) {
      const { data, error } = await this.db
        .from('packages')
        .select('id')
        .eq('clinic_id', CLINIC_A.id)
        .eq('patient_id', patientId)
        .eq('name', name)
      if (error) failures.push(`discover package ${name}: ${error.message}`)
      for (const row of data ?? []) this.track('packages', row.id)
    }
    for (const name of this.watchedAppointmentTypeNames) {
      const { data, error } = await this.db
        .from('appointment_types')
        .select('id')
        .eq('clinic_id', CLINIC_A.id)
        .eq('name', name)
      if (error) failures.push(`discover appointment type ${name}: ${error.message}`)
      for (const row of data ?? []) this.track('appointment_types', row.id)
    }
    for (const name of this.watchedPackageTemplateNames) {
      const { data, error } = await this.db
        .from('package_templates')
        .select('id')
        .eq('clinic_id', CLINIC_A.id)
        .eq('name', name)
      if (error) failures.push(`discover package template ${name}: ${error.message}`)
      for (const row of data ?? []) this.track('package_templates', row.id)
    }
    for (const { name, phone } of this.watchedExternalStaff.values()) {
      const { data, error } = await this.db
        .from('external_staff')
        .select('id')
        .eq('clinic_id', CLINIC_A.id)
        .eq('name', name)
        .eq('phone', phone)
      if (error) failures.push(`discover external staff ${name}: ${error.message}`)
      for (const row of data ?? []) this.track('external_staff', row.id)
    }
    for (const email of this.watchedInviteEmails) {
      const { data, error } = await this.db
        .from('user_invites')
        .select('id')
        .eq('email', email)
      if (error) failures.push(`discover invite ${email}: ${error.message}`)
      for (const row of data ?? []) this.track('user_invites', row.id)
    }
    if (this.watchedReminderTitles.size > 0) {
      const { error } = await this.db
        .from('reminders')
        .delete()
        .eq('clinic_id', CLINIC_A.id)
        .in('title', [...this.watchedReminderTitles])
      if (error) failures.push(`delete reminders: ${error.message}`)
    }
    for (const mobileNumber of this.watchedInviteMobiles) {
      const { data, error } = await this.db
        .from('user_invites')
        .select('id, auth_user_id')
        .eq('clinic_id', CLINIC_A.id)
        .eq('mobile_number', mobileNumber)
      if (error) failures.push(`discover mobile invite ${mobileNumber}: ${error.message}`)
      for (const row of data ?? []) {
        this.track('user_invites', row.id)
        if (!row.auth_user_id) continue
        const disposableEmail = `${this.token}-mobile-${mobileNumber}@carebook.test`
        const { error: emailError } = await this.db.auth.admin.updateUserById(row.auth_user_id, {
          email: disposableEmail,
          email_confirm: true,
        })
        if (emailError) {
          failures.push(`tag mobile invitee ${row.auth_user_id}: ${emailError.message}`)
          continue
        }
        this.trackAuthUser(row.auth_user_id, disposableEmail)
        this.trackProfile(row.auth_user_id, disposableEmail)
      }
    }

    for (const clinicId of this.created.get('clinics') ?? []) {
      for (const table of clinicScopedCleanupTables) {
        const { data, error } = await this.db.from(table).select('id').eq('clinic_id', clinicId)
        if (error) failures.push(`discover ${table} for clinic ${clinicId}: ${error.message}`)
        for (const row of data ?? []) this.track(table, row.id)
      }
    }

    // The soft-delete guard (033) only lets teardown hard-delete identities it can recognise by
    // an `@carebook.test` address, so mobile-only factory users get a disposable one first.
    for (const [id, mobileNumber] of this.emailLessAuthUsers) {
      const disposableEmail = `${this.token}-mobile-${mobileNumber}@carebook.test`
      const { error } = await this.db.auth.admin.updateUserById(id, { email: disposableEmail, email_confirm: true })
      if (error) {
        failures.push(`tag mobile-only user ${id}: ${error.message}`)
        continue
      }
      this.trackAuthUser(id, disposableEmail)
    }

    for (const [id, email] of this.authUsers) {
      await markAuthUserForCleanup(id, email)
    }

    // Production billing history is immutable. The local seed installs one service-role-only
    // cleanup RPC for disposable `E2E ...` patients so each browser test can still start from a
    // clean baseline without weakening any production migration or exposing a hosted backdoor.
    const patientIds = [...(this.created.get('patients') ?? [])]
    let patientCleanupSucceeded = true
    for (const patientId of patientIds) {
      const { error } = await this.db.rpc('cleanup_e2e_patient', {
        target_patient_id: patientId,
      })
      if (error) {
        patientCleanupSucceeded = false
        failures.push(`cleanup E2E patient ${patientId}: ${error.message}`)
      }
    }
    if (patientCleanupSucceeded && patientIds.length > 0) {
      for (const table of [
        'appointment_payments',
        'package_session_allocations',
        'session_notes',
        'payments',
        'packages',
        'appointments',
        'treatment_plans',
        'patients',
      ] as const) {
        this.created.delete(table)
      }
    } else {
      // When no disposable patient owns a receipt/package, retain those immutable roots just as
      // production does. This covers tests that deliberately exercise a fixed seeded patient.
      this.created.delete('payments')
      this.created.delete('packages')
    }

    for (const table of cleanupOrder) {
      const ids = [...(this.created.get(table) ?? [])]
      if (ids.length === 0) continue
      const { error } = await this.db.from(table).delete().in('id', ids)
      if (error) failures.push(`${table}: ${error.message}`)
    }
    if (this.watchedInviteEmails.size > 0) {
      for (let page = 1; page <= 20; page += 1) {
        const { data, error } = await this.db.auth.admin.listUsers({ page, perPage: 200 })
        if (error) {
          failures.push(`list invited auth users: ${error.message}`)
          break
        }
        for (const user of data.users) {
          if (!user.email || !this.watchedInviteEmails.has(user.email.toLowerCase())) continue
          this.trackAuthUser(user.id, user.email)
          this.trackProfile(user.id, user.email)
          await markAuthUserForCleanup(user.id, user.email.toLowerCase())
        }
        if (data.users.length < 200) break
      }
    }
    for (const [id, email] of this.authUsers) {
      await markAuthUserForCleanup(id, email)
      if (!markedAuthUsers.has(id)) continue
      const { error } = await this.db.auth.admin.deleteUser(id)
      if (error) failures.push(`delete auth user ${id} (${email}): ${error.message}`)
    }
    this.created.clear()
    this.watchedPatientNames.clear()
    this.watchedAppointments.clear()
    this.watchedSessionNoteAppointments.clear()
    this.watchedPayments.clear()
    this.watchedPackages.clear()
    this.watchedAppointmentTypeNames.clear()
    this.watchedPackageTemplateNames.clear()
    this.watchedExternalStaff.clear()
    this.watchedInviteEmails.clear()
    this.watchedInviteMobiles.clear()
    this.watchedReminderTitles.clear()
    this.watchedOnboardingRequests.clear()
    this.authUsers.clear()
    this.emailLessAuthUsers.clear()
    if (this.adminSession) {
      await this.adminSession.auth.signOut({ scope: 'local' }).catch(() => {})
      this.adminSession = null
    }
    if (failures.length > 0) throw new Error(`factory cleanup failed: ${failures.join('; ')}`)
  }
}

export const test = base.extend<{ factory: E2EFactory }>({
  factory: async ({}, run, testInfo) => {
    const factory = new E2EFactory(testInfo)
    try {
      await run(factory)
    } finally {
      await factory.cleanup()
    }
  },
})

export { expect }
