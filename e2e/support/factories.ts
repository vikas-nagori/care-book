import { randomUUID } from 'node:crypto'
import { test as base, expect, type TestInfo } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ADMIN, ALL_ACCOUNTS, CLINIC_A, CLINIC_B, PASSWORD } from './accounts.ts'
import { generateLocalInviteLink, generateLocalRecoveryLink } from './auth-links.ts'
import { clinicDate } from './clinic-date.ts'
import { SEED } from './ids.ts'
import { adminClient } from './supabase-admin.ts'

type Row = Record<string, unknown> & { id: string }
export type E2EPatientRow = Row & {
  clinic_id: string
  name: string
  phone: string
  email: string | null
  dob: string | null
  gender: string | null
  address: string | null
  medical_history: string | null
  notes: string | null
}
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
  password: string
  profile: E2EProfileRow
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
  email: string
  role: string
  status: string
  auth_user_id: string | null
  full_name: string | null
  mobile_number: string | null
  updated_at: string
}
export type E2EGlobalSettingsRow = {
  id: number
  clinic_id: string
  clinic_fee: number
  home_visit_fee: number
}
type CleanupTable =
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

const cleanupOrder: CleanupTable[] = [
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
  ]),
  clinics: new Set([CLINIC_A.id, CLINIC_B.id]),
  clinic_onboarding_requests: new Set([SEED.onboardingPending]),
  package_templates: new Set([SEED.packageTemplate]),
  packages: new Set([SEED.packageAsha]),
  patients: new Set([
    SEED.patientAsha,
    SEED.patientRavi,
    SEED.patientClinicB,
    SEED.patientPaymentDue,
  ]),
  payments: new Set([SEED.paymentAsha]),
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
  private readonly watchedOnboardingRequests = new Map<string, { ownerEmail: string; clinicName: string }>()
  private readonly authUsers = new Map<string, string>()

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

  async createPatient(overrides: Record<string, unknown> = {}): Promise<Row> {
    return this.insert('patients', {
      id: randomUUID(),
      clinic_id: CLINIC_A.id,
      name: this.uniqueName('patient'),
      phone: `9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`,
      ...overrides,
    })
  }

  async createAppointment({
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
    })
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

  async createOnboardingRequest(overrides: Record<string, unknown> = {}): Promise<Row> {
    const suffix = randomUUID().slice(0, 8)
    return this.insert('clinic_onboarding_requests', {
      id: randomUUID(),
      clinic_name: this.uniqueName('clinic-request'),
      owner_full_name: this.uniqueName('request-owner'),
      owner_email: `${this.token}-${suffix}@carebook.test`,
      owner_mobile_number: '9876500010',
      status: 'pending',
      ...overrides,
    })
  }

  async createClinic(overrides: Record<string, unknown> = {}): Promise<E2EClinicRow> {
    return this.insert('clinics', {
      id: randomUUID(),
      name: this.uniqueName('clinic'),
      status: 'active',
      ...overrides,
    }) as Promise<E2EClinicRow>
  }

  async createAuthUser(input: {
    clinicId: string
    email?: string
    password?: string
    role?: 'admin' | 'staff'
    fullName?: string
    mobileNumber?: string
    status?: 'active' | 'blocked'
  }): Promise<E2EAuthResource> {
    const email = (input.email ?? this.uniqueEmail('user')).trim().toLowerCase()
    const password = input.password ?? PASSWORD
    const { data, error } = await this.db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error || !data.user) {
      throw new Error(`factory create auth user: ${error?.message ?? 'user was not returned'}`)
    }
    this.trackAuthUser(data.user.id, email)
    this.trackProfile(data.user.id, email)

    const { data: profile, error: profileError } = await this.db
      .from('profiles')
      .update({
        clinic_id: input.clinicId,
        email,
        role: input.role ?? 'staff',
        full_name: input.fullName ?? this.uniqueName('user'),
        mobile_number: input.mobileNumber ?? this.uniqueMobile(),
        status: input.status ?? 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.user.id)
      .select('*')
      .single()
    if (profileError || !profile) {
      throw new Error(`factory update auth profile: ${profileError?.message ?? 'profile was not returned'}`)
    }

    return { id: data.user.id, email, password, profile: profile as E2EProfileRow }
  }

  async createUserInvite(input: {
    clinicId: string
    email: string
    authUserId?: string | null
    invitedBy?: string
    role?: 'admin' | 'staff'
    fullName?: string
    mobileNumber?: string
  }): Promise<E2EUserInviteRow> {
    const invitedBy = input.invitedBy ?? await this.findAuthUserIdByEmail(ADMIN.email)
    return this.insert('user_invites', {
      id: randomUUID(),
      clinic_id: input.clinicId,
      email: input.email.trim().toLowerCase(),
      role: input.role ?? 'staff',
      status: 'pending',
      auth_user_id: input.authUserId ?? null,
      invited_by: invitedBy,
      full_name: input.fullName ?? this.uniqueName('invitee'),
      mobile_number: input.mobileNumber ?? this.uniqueMobile(),
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

    for (const clinicId of this.created.get('clinics') ?? []) {
      for (const table of clinicScopedCleanupTables) {
        const { data, error } = await this.db.from(table).select('id').eq('clinic_id', clinicId)
        if (error) failures.push(`discover ${table} for clinic ${clinicId}: ${error.message}`)
        for (const row of data ?? []) this.track(table, row.id)
      }
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
    this.watchedOnboardingRequests.clear()
    this.authUsers.clear()
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
