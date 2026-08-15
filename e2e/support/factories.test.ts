import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TestInfo } from '@playwright/test'
import { ADMIN, CLINIC_A, CLINIC_B } from './accounts.ts'
import { E2EFactory } from './factories.ts'

type MockRow = Record<string, unknown> & { id: string }
type DeleteCall = { table: string; ids: string[] }
type RpcCall = { functionName: string; args: Record<string, unknown> }
type AuthDeleteCall = { id: string }
type AuthUpdateCall = { id: string; attributes: Record<string, unknown> }

function testInfo(): TestInfo {
  return {
    project: { name: 'admin-desktop' },
    workerIndex: 2,
    retry: 0,
  } as unknown as TestInfo
}

function queryableDb(
  rows: Record<string, MockRow[]>,
  deletes: DeleteCall[],
  authUsers: { id: string; email: string }[] = [],
  authDeletes: AuthDeleteCall[] = [],
  authUpdates: AuthUpdateCall[] = [],
  rpcCalls: RpcCall[] = [],
): SupabaseClient {
  return {
    async rpc(functionName: string, args: Record<string, unknown>) {
      rpcCalls.push({ functionName, args })
      return { data: null, error: null }
    },
    auth: {
      admin: {
        async listUsers() {
          return { data: { users: authUsers }, error: null }
        },
        async deleteUser(id: string) {
          authDeletes.push({ id })
          return { data: { user: null }, error: null }
        },
        async updateUserById(id: string, attributes: Record<string, unknown>) {
          authUpdates.push({ id, attributes })
          return { data: { user: { id } }, error: null }
        },
      },
    },
    from(table: string) {
      const filters = new Map<string, unknown>()
      const result = () => ({
        data: (rows[table] ?? []).filter((row) =>
          [...filters].every(([column, value]) => row[column] === value)),
        error: null,
      })
      const builder = {
        select() {
          return builder
        },
        eq(column: string, value: unknown) {
          filters.set(column, value)
          return builder
        },
        in(column: string, values: unknown[]) {
          const allowed = new Set(values)
          const matching = (rows[table] ?? []).filter((row) =>
            [...filters].every(([filterColumn, value]) => row[filterColumn] === value)
              && allowed.has(row[column]),
          )
          return Promise.resolve({ data: matching, error: null })
        },
        delete() {
          return {
            async in(_column: string, ids: string[]) {
              deletes.push({ table, ids })
              return { error: null }
            },
          }
        },
        async maybeSingle() {
          const matches = result().data
          return { data: matches[0] ?? null, error: null }
        },
        then<TResult1 = ReturnType<typeof result>, TResult2 = never>(
          onfulfilled?: ((value: ReturnType<typeof result>) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return Promise.resolve(result()).then(onfulfilled, onrejected)
        },
      }
      return builder
    },
  } as unknown as SupabaseClient
}

test('tracked UI row IDs are cleaned in dependency order without touching baseline rows', async () => {
  const deletes: DeleteCall[] = []
  const rpcCalls: RpcCall[] = []
  const db = queryableDb({}, deletes, [], [], [], rpcCalls)
  const factory = new E2EFactory(testInfo(), db)

  factory.trackPatient('ui-patient-id')
  factory.trackAppointment('ui-appointment-id')
  factory.trackSessionNote('ui-note-id')
  await factory.cleanup()

  assert.deepEqual(rpcCalls, [{
    functionName: 'cleanup_e2e_patient',
    args: { target_patient_id: 'ui-patient-id' },
  }])
  assert.deepEqual(deletes, [])
})

test('disposable platform resources clean exact profile, clinic, request, and auth IDs in FK-safe order', async () => {
  const deletes: DeleteCall[] = []
  const authDeletes: AuthDeleteCall[] = []
  const authUpdates: AuthUpdateCall[] = []
  const db = queryableDb({}, deletes, [
    { id: 'temp-auth-id', email: 'temp-platform-user@carebook.test' },
    { id: 'baseline-auth-id', email: 'admin@carebook.test' },
  ], authDeletes, authUpdates)
  const factory = new E2EFactory(testInfo(), db)

  factory.trackOnboardingRequest('temp-request-id')
  factory.trackProfile('temp-auth-id', 'temp-platform-user@carebook.test')
  factory.trackClinic('temp-clinic-id')
  factory.trackAuthUser('temp-auth-id', 'temp-platform-user@carebook.test')
  await factory.cleanup()

  assert.deepEqual(deletes, [
    { table: 'clinic_onboarding_requests', ids: ['temp-request-id'] },
    { table: 'profiles', ids: ['temp-auth-id'] },
    { table: 'clinics', ids: ['temp-clinic-id'] },
  ])
  assert.deepEqual(authDeletes, [{ id: 'temp-auth-id' }])
  assert.deepEqual(authUpdates, [{
    id: 'temp-auth-id',
    attributes: {
      app_metadata: {
        carebook_e2e_cleanup: {
          state: 'requested',
          reason: `Playwright cleanup ${factory.token}`,
        },
      },
    },
  }])
})

test('looking up a seeded clinic and profile never enrolls them for cleanup', async () => {
  const deletes: DeleteCall[] = []
  const authDeletes: AuthDeleteCall[] = []
  const db = queryableDb({
    clinics: [{ id: CLINIC_A.id, name: CLINIC_A.name }],
    profiles: [{ id: 'seed-admin-profile-id', email: ADMIN.email }],
  }, deletes, [], authDeletes)
  const factory = new E2EFactory(testInfo(), db)

  assert.equal((await factory.findClinicById(CLINIC_A.id))?.id, CLINIC_A.id)
  assert.equal((await factory.findProfileById('seed-admin-profile-id'))?.id, 'seed-admin-profile-id')
  await factory.cleanup()

  assert.deepEqual(deletes, [])
  assert.deepEqual(authDeletes, [])
})

test('fixed seed clinics cannot be explicitly enrolled for cleanup', async () => {
  const deletes: DeleteCall[] = []
  const authDeletes: AuthDeleteCall[] = []
  const factory = new E2EFactory(testInfo(), queryableDb({}, deletes, [], authDeletes))

  factory.trackClinic(CLINIC_A.id)
  factory.trackClinic(CLINIC_B.id)
  factory.trackProfile('seed-admin-profile-id', ADMIN.email)
  factory.trackAuthUser('seed-admin-profile-id', ADMIN.email)
  await factory.cleanup()

  assert.deepEqual(deletes, [])
  assert.deepEqual(authDeletes, [])
})

test('watched UI values discover partial-failure rows without deleting fixed baseline IDs', async () => {
  const deletes: DeleteCall[] = []
  const rpcCalls: RpcCall[] = []
  const baselineIds = ['baseline-patient-id', 'baseline-appointment-id', 'baseline-note-id']
  const db = queryableDb({
    patients: [
      { id: 'ui-patient-id', clinic_id: CLINIC_A.id, name: 'Watched Patient' },
      { id: baselineIds[0], clinic_id: CLINIC_A.id, name: 'Seed Patient' },
    ],
    appointments: [
      {
        id: 'ui-appointment-id',
        clinic_id: CLINIC_A.id,
        patient_id: 'ui-patient-id',
        notes: 'watched-notes',
      },
      {
        id: baselineIds[1],
        clinic_id: CLINIC_A.id,
        patient_id: 'ui-patient-id',
        notes: 'seed-notes',
      },
    ],
    session_notes: [
      { id: 'ui-note-id', appointment_id: 'ui-appointment-id' },
      { id: baselineIds[2], appointment_id: baselineIds[1] },
    ],
  }, deletes, [], [], [], rpcCalls)
  const factory = new E2EFactory(testInfo(), db)

  factory.watchUiPatient('Watched Patient')
  factory.watchUiAppointments({ patientId: 'ui-patient-id', notes: 'watched-notes' })
  factory.watchUiSessionNote('ui-appointment-id')
  await factory.cleanup()

  assert.deepEqual(rpcCalls, [{
    functionName: 'cleanup_e2e_patient',
    args: { target_patient_id: 'ui-patient-id' },
  }])
  assert.deepEqual(deletes, [])
  assert.deepEqual(
    deletes.flatMap(({ ids }) => ids).filter((id) => baselineIds.includes(id)),
    [],
  )
})

test('billing watchers retain immutable audit rows while settings watchers clean exact matches', async () => {
  const deletes: DeleteCall[] = []
  const authDeletes: AuthDeleteCall[] = []
  const invitedEmail = 'exact-invite@carebook.test'
  const baselineIds = [
    'baseline-payment-id',
    'baseline-package-id',
    'baseline-type-id',
    'baseline-template-id',
    'baseline-staff-id',
    'baseline-invite-id',
    'baseline-auth-id',
  ]
  const db = queryableDb({
    payments: [
      { id: 'ui-payment-id', clinic_id: CLINIC_A.id, patient_id: 'patient-id', notes: 'exact payment' },
      { id: baselineIds[0], clinic_id: CLINIC_A.id, patient_id: 'patient-id', notes: 'other payment' },
    ],
    packages: [
      { id: 'ui-package-id', clinic_id: CLINIC_A.id, patient_id: 'patient-id', name: 'Exact package' },
      { id: baselineIds[1], clinic_id: CLINIC_A.id, patient_id: 'patient-id', name: 'Other package' },
    ],
    appointment_types: [
      { id: 'ui-type-id', clinic_id: CLINIC_A.id, name: 'Exact type' },
      { id: baselineIds[2], clinic_id: CLINIC_A.id, name: 'Other type' },
    ],
    package_templates: [
      { id: 'ui-template-id', clinic_id: CLINIC_A.id, name: 'Exact template' },
      { id: baselineIds[3], clinic_id: CLINIC_A.id, name: 'Other template' },
    ],
    external_staff: [
      { id: 'ui-staff-id', clinic_id: CLINIC_A.id, name: 'Exact staff', phone: '9000000001' },
      { id: baselineIds[4], clinic_id: CLINIC_A.id, name: 'Exact staff', phone: '9000000002' },
    ],
    user_invites: [
      { id: 'ui-invite-id', clinic_id: CLINIC_A.id, email: invitedEmail },
      { id: baselineIds[5], clinic_id: CLINIC_A.id, email: 'baseline@carebook.test' },
    ],
  }, deletes, [
    { id: 'ui-auth-id', email: invitedEmail },
    { id: baselineIds[6], email: 'baseline@carebook.test' },
  ], authDeletes)
  const factory = new E2EFactory(testInfo(), db)

  factory.watchUiPayment({ patientId: 'patient-id', notes: 'exact payment' })
  factory.watchUiPackage({ patientId: 'patient-id', name: 'Exact package' })
  factory.watchUiAppointmentType('Exact type')
  factory.watchUiPackageTemplate('Exact template')
  factory.watchUiExternalStaff({ name: 'Exact staff', phone: '9000000001' })
  factory.watchUiInvite(invitedEmail)
  await factory.cleanup()

  assert.deepEqual(deletes, [
    { table: 'user_invites', ids: ['ui-invite-id'] },
    { table: 'appointment_types', ids: ['ui-type-id'] },
    { table: 'package_templates', ids: ['ui-template-id'] },
    { table: 'external_staff', ids: ['ui-staff-id'] },
  ])
  assert.deepEqual(authDeletes, [{ id: 'ui-auth-id' }])
  assert.deepEqual(
    deletes.flatMap(({ ids }) => ids).filter((id) => baselineIds.includes(id)),
    [],
  )
})
