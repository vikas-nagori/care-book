import { randomUUID } from 'node:crypto'
import { test as base, expect, type TestInfo } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLINIC_A } from './accounts.ts'
import { clinicDate } from './clinic-date.ts'
import { adminClient } from './supabase-admin.ts'

type Row = Record<string, unknown> & { id: string }
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
    for (const table of cleanupOrder) {
      const ids = [...(this.created.get(table) ?? [])]
      if (ids.length === 0) continue
      const { error } = await this.db.from(table).delete().in('id', ids)
      if (error) failures.push(`${table}: ${error.message}`)
    }
    this.created.clear()
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
