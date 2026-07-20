import { randomUUID } from 'node:crypto'
import { test as base, expect, type TestInfo } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLINIC_A } from './accounts.ts'
import { clinicDate } from './clinic-date.ts'
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
}
export type E2EProfileRow = Row & {
  email: string
  full_name: string | null
  role: string
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
  | 'clinic_onboarding_requests'

const cleanupOrder: CleanupTable[] = [
  'appointment_payments',
  'package_session_allocations',
  'session_notes',
  'payments',
  'packages',
  'appointments',
  'treatment_plans',
  'patients',
  'appointment_types',
  'package_templates',
  'clinic_onboarding_requests',
]

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

  constructor(testInfo: TestInfo, db: SupabaseClient = adminClient()) {
    this.token = uniqueRunToken(testInfo)
    this.db = db
  }

  uniqueName(kind: string): string {
    this.sequence += 1
    return `E2E ${this.token} ${kind} ${this.sequence}`
  }

  private async insert(table: CleanupTable, values: Row): Promise<Row> {
    const { data, error } = await this.db.from(table).insert(values).select('*').single()
    if (error || !data) {
      throw new Error(`factory insert ${table}: ${error?.message ?? 'row was not returned'}`)
    }
    const row = data as Row
    const ids = this.created.get(table) ?? new Set<string>()
    ids.add(row.id)
    this.created.set(table, ids)
    return row
  }

  private track(table: CleanupTable, id: string): void {
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

  async findAppointmentType(isShared: boolean): Promise<E2EAppointmentTypeRow> {
    const { data, error } = await this.db
      .from('appointment_types')
      .select('id, name, is_shared')
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

  async createPackage({
    patientId,
    ...overrides
  }: {
    patientId: string
    [key: string]: unknown
  }): Promise<Row> {
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
    return this.insert('payments', {
      id: randomUUID(),
      clinic_id: CLINIC_A.id,
      patient_id: patientId,
      amount: 750,
      payment_method: 'UPI',
      date: clinicDate(),
      notes: this.uniqueName('payment'),
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

  async cleanup(): Promise<void> {
    const failures: string[] = []
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

    for (const table of cleanupOrder) {
      const ids = [...(this.created.get(table) ?? [])]
      if (ids.length === 0) continue
      const { error } = await this.db.from(table).delete().in('id', ids)
      if (error) failures.push(`${table}: ${error.message}`)
    }
    this.created.clear()
    this.watchedPatientNames.clear()
    this.watchedAppointments.clear()
    this.watchedSessionNoteAppointments.clear()
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
