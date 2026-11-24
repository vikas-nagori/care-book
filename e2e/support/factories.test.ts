import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TestInfo } from '@playwright/test'
import { ADMIN, CLINIC_A, CLINIC_B } from './accounts.ts'
import { E2EFactory } from './factories.ts'
import { SEED, SPARSE_PROFILES } from './ids.ts'

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

type InsertCall = { table: string; values: MockRow[] }
type UpdateCall = { table: string; values: Record<string, unknown>; filters: Record<string, unknown> }

function queryableDb(
  rows: Record<string, MockRow[]>,
  deletes: DeleteCall[],
  authUsers: { id: string; email: string }[] = [],
  authDeletes: AuthDeleteCall[] = [],
  authUpdates: AuthUpdateCall[] = [],
  rpcCalls: RpcCall[] = [],
  inserts: InsertCall[] = [],
  createdAuthUsers: Record<string, unknown>[] = [],
  /** Every delete and auth call in the order made, e.g. `delete profiles` / `mark auth-id`. */
  log: string[] = [],
  updates: UpdateCall[] = [],
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
          log.push(`delete auth ${id}`)
          return { data: { user: null }, error: null }
        },
        async updateUserById(id: string, attributes: Record<string, unknown>) {
          authUpdates.push({ id, attributes })
          log.push(`${'app_metadata' in attributes && 'carebook_e2e_cleanup' in (attributes.app_metadata as object) ? 'mark' : 'update'} auth ${id}`)
          return { data: { user: { id } }, error: null }
        },
        async createUser(attributes: Record<string, unknown>) {
          createdAuthUsers.push(attributes)
          return { data: { user: { id: `auth-${createdAuthUsers.length}` } }, error: null }
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
        insert(values: MockRow | MockRow[]) {
          const list = Array.isArray(values) ? values : [values]
          inserts.push({ table, values: list })
          const inserted = {
            select() { return inserted },
            async single() { return { data: list[0], error: null } },
            then<TResult1 = { data: MockRow[]; error: null }>(
              onfulfilled?: ((value: { data: MockRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
            ) {
              return Promise.resolve({ data: list, error: null }).then(onfulfilled)
            },
          }
          return inserted
        },
        update(values: Record<string, unknown>) {
          const updateFilters: Record<string, unknown> = {}
          const inFilters = new Map<string, Set<unknown>>()
          const matching = () => (rows[table] ?? []).filter((row) =>
            Object.entries(updateFilters).every(([column, value]) => row[column] === value)
              && [...inFilters].every(([column, allowed]) => allowed.has(row[column])))
          const run = () => {
            updates.push({ table, values, filters: { ...updateFilters, ...Object.fromEntries([...inFilters].map(([c, s]) => [c, [...s]])) } })
            return { data: matching().map((row) => ({ ...row, ...values })), error: null }
          }
          const updated = {
            eq(column: string, value: unknown) { updateFilters[column] = value; return updated },
            in(column: string, list: unknown[]) { inFilters.set(column, new Set(list)); return updated },
            select() { return updated },
            async single() { updates.push({ table, values, filters: { ...updateFilters } }); return { data: { id: 'profile', ...values }, error: null } },
            then<TResult1 = ReturnType<typeof run>>(
              onfulfilled?: ((value: ReturnType<typeof run>) => TResult1 | PromiseLike<TResult1>) | null,
            ) {
              return Promise.resolve(run()).then(onfulfilled)
            },
          }
          return updated
        },
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
              log.push(`delete ${table}`)
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
    // The invited login is found before anything is deleted, so its profile goes with the rows.
    { table: 'profiles', ids: ['ui-auth-id'] },
  ])
  assert.deepEqual(authDeletes, [{ id: 'ui-auth-id' }])
  assert.deepEqual(
    deletes.flatMap(({ ids }) => ids).filter((id) => baselineIds.includes(id)),
    [],
  )
})

test('blank optional invite fields stay NULL instead of being filled with defaults', async () => {
  const inserts: InsertCall[] = []
  const factory = new E2EFactory(testInfo(), queryableDb({}, [], [], [], [], [], inserts))

  await factory.createUserInvite({
    clinicId: CLINIC_A.id, email: 'legacy@carebook.test', invitedBy: 'admin-id', fullName: null, mobileNumber: null,
  })
  await factory.createUserInvite({ clinicId: CLINIC_A.id, email: null, invitedBy: 'admin-id', status: 'revoked' })

  const [legacy, mobileOnly] = inserts.map(({ values }) => values[0])
  assert.equal(legacy.full_name, null)
  assert.equal(legacy.mobile_number, null)
  assert.equal(legacy.email, 'legacy@carebook.test')
  assert.equal(mobileOnly.email, null)
  assert.match(String(mobileOnly.mobile_number), /^9\d{9}$/)
  assert.equal(mobileOnly.status, 'revoked')
  assert.ok(mobileOnly.revoked_at)
})

test('onboarding requests get a unique owner mobile and can collide on an owner email on purpose', async () => {
  const inserts: InsertCall[] = []
  const factory = new E2EFactory(testInfo(), queryableDb({}, [], [], [], [], [], inserts))

  await factory.createOnboardingRequest()
  await factory.createOnboardingRequest()
  await factory.createOnboardingRequest({ ownerEmail: ' Admin@CareBook.test ', clinic_phone: null })

  const [first, second, colliding] = inserts.map(({ values }) => values[0])
  assert.notEqual(first.owner_mobile_number, second.owner_mobile_number)
  assert.notEqual(first.owner_email, second.owner_email)
  assert.equal(colliding.owner_email, 'admin@carebook.test')
  assert.equal(colliding.clinic_phone, null)
})

test('bulk builders track every row before inserting and give each a distinct date or name', async () => {
  const inserts: InsertCall[] = []
  const rpcCalls: RpcCall[] = []
  const factory = new E2EFactory(testInfo(), queryableDb({}, [], [], [], [], rpcCalls, inserts))

  const patients = await factory.createPatients(3, (index) => ({ phone: index === 0 ? null : undefined }))
  const payments = await factory.createPayments(4, { patientId: patients[0].id, startDayOffset: -10 })

  assert.equal(new Set(patients.map((patient) => patient.name)).size, 3)
  assert.equal(patients[0].phone, null)
  assert.equal(new Set(payments.map((payment) => payment.date)).size, 4)
  await factory.cleanup()
  assert.deepEqual(rpcCalls.map(({ args }) => args.target_patient_id).sort(), patients.map(({ id }) => id).sort())
})

test('factory-made reminders, notes, plans, doctors and temporary staff are cleaned; sparse seed rows never are', async () => {
  const deletes: DeleteCall[] = []
  const factory = new E2EFactory(testInfo(), queryableDb({}, deletes))

  const reminder = await factory.createReminder()
  const doctor = await factory.createDoctor()
  const staff = await factory.createExternalStaff()
  factory.trackSessionNote(SEED.sessionNoteSparse)
  factory.trackPatient(SEED.patientSparse)
  factory.trackAppointment(SEED.appointmentExternalSparse)
  await factory.cleanup()

  assert.deepEqual(deletes, [
    { table: 'reminders', ids: [reminder.id] },
    { table: 'external_staff', ids: [staff.id] },
    { table: 'doctors', ids: [doctor.id] },
  ])
})

test('destructive helpers refuse fixed SEED rows', async () => {
  const factory = new E2EFactory(testInfo(), queryableDb({}, []))

  await assert.rejects(factory.deletePatientHard(SEED.patientSparse), /fixed SEED patient/)
  await assert.rejects(factory.deleteAppointmentHard(SEED.appointmentSparse), /fixed SEED appointment/)
  await assert.rejects(factory.shareWithExternal(SEED.patientExternal, []), /fixed SEED patient/)
})

test('a mobile-only factory user gets a disposable address before teardown deletes it', async () => {
  const authUpdates: AuthUpdateCall[] = []
  const authDeletes: AuthDeleteCall[] = []
  const created: Record<string, unknown>[] = []
  const factory = new E2EFactory(testInfo(), queryableDb({}, [], [], authDeletes, authUpdates, [], [], created))

  const user = await factory.createAuthUser({ clinicId: CLINIC_A.id, email: null, fullName: null, role: 'external_staff' })
  assert.equal(user.email, null)
  assert.equal(created[0].email, undefined)
  assert.equal(created[0].phone, user.mobileNumber)
  await factory.cleanup()

  assert.equal(authUpdates[0].id, user.id)
  assert.equal(authUpdates[0].attributes.email, `${factory.token}-mobile-${user.mobileNumber}@carebook.test`)
  assert.ok(authUpdates.some(({ attributes }) => 'app_metadata' in attributes))
  assert.deepEqual(authDeletes, [{ id: user.id }])
})

test('an approved onboarding request leaves no login or clinic behind, even when the spec tracked neither', async () => {
  const deletes: DeleteCall[] = []
  const authDeletes: AuthDeleteCall[] = []
  const log: string[] = []
  const ownerEmail = 'owner-x@carebook.test'
  const db = queryableDb({
    clinic_onboarding_requests: [
      { id: 'request-id', owner_email: ownerEmail, clinic_name: 'E2E clinic', clinic_id: 'approved-clinic-id' },
    ],
    clinics: [{ id: 'approved-clinic-id', name: 'E2E clinic' }],
    user_invites: [
      { id: 'owner-invite-id', clinic_id: 'approved-clinic-id', email: ownerEmail, auth_user_id: 'owner-auth-id' },
      { id: 'other-clinic-invite-id', clinic_id: CLINIC_A.id, email: ownerEmail, auth_user_id: 'other-auth-id' },
    ],
    profiles: [
      { id: 'owner-auth-id', clinic_id: 'approved-clinic-id', email: ownerEmail, mobile_number: '9111111111' },
      { id: 'member-auth-id', clinic_id: 'approved-clinic-id', email: 'member-x@carebook.test', mobile_number: '9111111112' },
    ],
  }, deletes, [], authDeletes, [], [], [], [], log)
  const factory = new E2EFactory(testInfo(), db)

  factory.watchUiOnboardingRequest({ ownerEmail, clinicName: 'E2E clinic' })
  await factory.cleanup()

  const deleted = (table: string) => deletes.filter((call) => call.table === table).flatMap(({ ids }) => ids)
  assert.deepEqual(deleted('clinics'), ['approved-clinic-id'])
  assert.deepEqual(deleted('clinic_onboarding_requests'), ['request-id'])
  assert.ok(deleted('user_invites').includes('owner-invite-id'))
  assert.equal(deleted('user_invites').includes('other-clinic-invite-id'), false, 'an invite in another clinic is not the approval')
  assert.deepEqual(deleted('profiles').sort(), ['member-auth-id', 'owner-auth-id'])
  assert.deepEqual(authDeletes.map(({ id }) => id).sort(), ['member-auth-id', 'owner-auth-id'])
  // 033: a profile can only be deleted once its login is marked for cleanup.
  for (const id of ['owner-auth-id', 'member-auth-id']) {
    const marked = log.indexOf(`mark auth ${id}`)
    assert.ok(marked !== -1 && marked < log.indexOf('delete profiles'), log.join('\n'))
  }
})

test('trackApprovedOwner tracks the owner login, profile, invite and clinic, and fails without a login', async () => {
  const deletes: DeleteCall[] = []
  const authDeletes: AuthDeleteCall[] = []
  const db = queryableDb({
    user_invites: [
      { id: 'owner-invite-id', clinic_id: 'approved-clinic-id', email: 'owner-y@carebook.test', auth_user_id: 'owner-auth-id' },
      { id: 'no-login-invite-id', clinic_id: CLINIC_A.id, email: 'nologin@carebook.test', auth_user_id: null },
    ],
  }, deletes, [], authDeletes)
  const factory = new E2EFactory(testInfo(), db)

  assert.deepEqual(await factory.trackApprovedOwner(' Owner-Y@carebook.test '), { authUserId: 'owner-auth-id', clinicId: 'approved-clinic-id' })
  await assert.rejects(factory.trackApprovedOwner('nologin@carebook.test'), /has no invite with an auth user/)
  await factory.cleanup()

  const deleted = (table: string) => deletes.filter((call) => call.table === table).flatMap(({ ids }) => ids)
  assert.deepEqual(deleted('user_invites'), ['owner-invite-id'])
  assert.deepEqual(deleted('profiles'), ['owner-auth-id'])
  assert.deepEqual(deleted('clinics'), ['approved-clinic-id'])
  assert.deepEqual(authDeletes, [{ id: 'owner-auth-id' }])
})

test('onboarding lookups survive several rows per email, and rejection touches only pending non-seed rows', async () => {
  const updates: UpdateCall[] = []
  const email = 'repeat@carebook.test'
  const db = queryableDb({
    clinic_onboarding_requests: [
      { id: 'old', owner_email: email, status: 'rejected', created_at: '2026-11-01T00:00:00Z' },
      { id: 'new', owner_email: email, status: 'pending', created_at: '2026-11-02T00:00:00Z' },
      { id: SEED.onboardingPending, owner_email: 'seed@carebook.test', status: 'pending', created_at: '2026-01-01T00:00:00Z' },
    ],
  }, [], [], [], [], [], [], [], [], updates)
  const factory = new E2EFactory(testInfo(), db)

  assert.equal((await factory.findOnboardingRequestByEmail(email))?.id, 'new')
  assert.deepEqual((await factory.findOnboardingRequestsByEmail(email)).map(({ id }) => id), ['new', 'old'])

  const rejected = await factory.rejectOnboardingRequest({ ownerEmail: email }, { reason: 'duplicate' })
  assert.deepEqual(rejected.map(({ id, status }) => ({ id, status })), [{ id: 'new', status: 'rejected' }])
  assert.deepEqual(updates[0].filters, { status: 'pending', id: ['new'] })
  assert.equal(updates[0].values.rejection_reason, 'duplicate')
  await assert.rejects(factory.rejectOnboardingRequest(SEED.onboardingPending), /fixed SEED request/)
  await assert.rejects(factory.rejectOnboardingRequest('old'), /no pending request/)
})

test('profile status and the forced password change apply to factory users only', async () => {
  const authUpdates: AuthUpdateCall[] = []
  const updates: UpdateCall[] = []
  const db = queryableDb({
    profiles: [
      { id: 'user-id', email: 'user@carebook.test', mobile_number: '9222222222' },
      { id: 'seed-admin-id', email: ADMIN.email, mobile_number: ADMIN.mobile },
      { id: 'seed-sparse-id', email: null, mobile_number: SPARSE_PROFILES.mobileOnly.mobile },
    ],
  }, [], [], [], authUpdates, [], [], [], [], updates)
  const factory = new E2EFactory(testInfo(), db)

  await factory.setProfileStatus('user-id', 'blocked')
  assert.deepEqual(updates.map(({ table, values, filters }) => ({ table, status: values.status, filters })), [
    { table: 'profiles', status: 'blocked', filters: { id: 'user-id' } },
  ])
  assert.deepEqual(authUpdates, [], 'no ban unless asked')
  await factory.setProfileStatus('user-id', 'active', { ban: true })
  assert.deepEqual(authUpdates.at(-1), { id: 'user-id', attributes: { ban_duration: 'none' } })
  await factory.setProfileStatus('user-id', 'blocked', { ban: true })
  assert.deepEqual(authUpdates.at(-1), { id: 'user-id', attributes: { ban_duration: '876000h' } })

  await factory.setMustChangePassword('user-id')
  assert.deepEqual(authUpdates.at(-1), { id: 'user-id', attributes: { app_metadata: { must_change_password: true } } })
  await factory.setMustChangePassword('user-id', false)
  assert.deepEqual(authUpdates.at(-1), { id: 'user-id', attributes: { app_metadata: { must_change_password: false } } })

  await assert.rejects(factory.setProfileStatus('seed-admin-id', 'blocked'), /seeded account/)
  await assert.rejects(factory.setMustChangePassword('seed-sparse-id'), /seeded account/)
})

test('invites by mobile: every row, newest first, and all of them cleaned', async () => {
  const deletes: DeleteCall[] = []
  const db = queryableDb({
    user_invites: [
      { id: 'first', clinic_id: CLINIC_A.id, mobile_number: '9333333333', created_at: '2026-11-01T00:00:00Z' },
      { id: 'second', clinic_id: CLINIC_A.id, mobile_number: '9333333333', created_at: '2026-11-02T00:00:00Z' },
      { id: 'other-clinic', clinic_id: CLINIC_B.id, mobile_number: '9333333333', created_at: '2026-11-03T00:00:00Z' },
    ],
  }, deletes)
  const factory = new E2EFactory(testInfo(), db)

  assert.deepEqual((await factory.findInvitesByMobile('9333333333')).map(({ id }) => id), ['second', 'first'])
  assert.equal(await factory.countInvitesByMobile('9333333333', { clinicId: CLINIC_B.id }), 1)
  await factory.cleanup()
  assert.deepEqual(deletes, [{ table: 'user_invites', ids: ['second', 'first', 'other-clinic'] }])
})

test('bulk payments and packages can vary per row and keep their defaults otherwise', async () => {
  const inserts: InsertCall[] = []
  const factory = new E2EFactory(testInfo(), queryableDb({}, [], [], [], [], [], inserts))

  const plain = await factory.createPayments(2, { patientId: 'patient-id' })
  const varied = await factory.createPayments(3, { patientId: 'patient-id', payment_method: 'upi', perRow: (i) => ({ amount: 1001 + i }) })
  const packages = await factory.createPackages(2, {
    patientId: 'patient-id', appointmentTypeId: 'type-id',
    perRow: (i) => ({ created_at: new Date(Date.UTC(2016, 0, 1) - i * 86_400_000).toISOString() }),
  })

  assert.deepEqual(plain.map(({ amount }) => amount), [750, 750])
  assert.deepEqual(varied.map(({ amount }) => amount), [1001, 1002, 1003])
  assert.deepEqual(varied.map(({ payment_method }) => payment_method), ['upi', 'upi', 'upi'])
  assert.equal('perRow' in inserts[1].values[0], false, 'perRow is not a column')
  assert.deepEqual(packages.map((row) => row.created_at), ['2016-01-01T00:00:00.000Z', '2015-12-31T00:00:00.000Z'])
  assert.deepEqual(packages.map(({ total_amount }) => total_amount), [3000, 3000])
})

test('a watched slot cleans the UI bookings on a seed patient, never the seed appointments', async () => {
  const deletes: DeleteCall[] = []
  const rpcCalls: RpcCall[] = []
  const slot = { patientId: SEED.patientExternal, date: '2026-12-01', time: '15:10' }
  const db = queryableDb({
    appointments: [
      { id: 'ui-booking', ...slot, patient_id: slot.patientId, external_profile_id: 'external-id', created_at: '2026-11-24T01:00:00Z' },
      { id: 'clinic-booking', ...slot, patient_id: slot.patientId, external_profile_id: null, created_at: '2026-11-24T02:00:00Z' },
      { id: SEED.appointmentExternal, ...slot, patient_id: slot.patientId, external_profile_id: 'external-id', created_at: '2026-01-01T00:00:00Z' },
    ],
  }, deletes, [], [], [], rpcCalls)
  const factory = new E2EFactory(testInfo(), db)

  // A disposable patient too: its cleanup RPC must not swallow the seed patient's slot.
  factory.trackPatient('factory-patient-id')
  factory.watchUiAppointmentSlot({ ...slot, externalOnly: true })
  assert.deepEqual(
    (await factory.findAppointmentsInSlot({ ...slot, externalOnly: true })).map(({ id }) => id),
    [SEED.appointmentExternal, 'ui-booking'],
  )
  await factory.cleanup()

  assert.deepEqual(rpcCalls.map(({ args }) => args.target_patient_id), ['factory-patient-id'])
  assert.deepEqual(deletes, [
    { table: 'session_notes', ids: ['ui-booking'] },
    { table: 'appointment_payments', ids: ['ui-booking'] },
    { table: 'appointments', ids: ['ui-booking'] },
  ])
})
