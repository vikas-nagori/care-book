import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadDashboardAppointmentOptions,
  type AppointmentOptionsLoaderDependencies,
  type StaffAppointmentTypeOption,
} from './appointment-options.ts'
import type { Profile } from '../supabase/types.ts'

const activeAdmin: Profile = {
  id: 'admin-1',
  clinic_id: 'clinic-1',
  email: 'admin@example.test',
  role: 'admin',
  full_name: 'Admin User',
  mobile_number: null,
  status: 'active',
  deleted_at: null,
  deleted_by: null,
  deletion_reason: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const rowsByTable = {
  patients: [{ id: 'patient-1', name: 'Patient One' }],
  doctors: [{
    id: 'doctor-1',
    clinic_id: 'clinic-1',
    name: 'Doctor One',
    specialty: null,
    address: null,
    created_by: 'admin-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }],
  profiles: [{
    id: 'staff-1',
    email: 'staff@example.test',
    role: 'staff',
    full_name: 'Staff One',
  }],
  external_staff: [{
    id: 'external-1',
    clinic_id: 'clinic-1',
    name: 'External One',
    phone: '9999999999',
    email: null,
    notes: null,
    status: 'active',
    linked_profile_id: null,
    created_by: 'admin-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }],
  appointment_types: [{
    id: 'type-1',
    clinic_id: 'clinic-1',
    name: 'Clinic Visit',
    session_rate: 800,
    is_shared: true,
    is_default: true,
    sort_order: 1,
    created_at: '2026-01-01T00:00:00Z',
  }],
}

type TableName = keyof typeof rowsByTable

function dependencies({
  profile = activeAdmin,
  failingTable,
}: {
  profile?: Profile | null
  failingTable?: TableName
} = {}) {
  const selections = new Map<string, string>()
  const logCalls: { context: string; error: unknown }[] = []

  class Query implements PromiseLike<{ data: unknown[] | null; error: unknown }> {
    private readonly table: TableName

    constructor(table: TableName) {
      this.table = table
    }

    select(columns: string) {
      selections.set(this.table, columns)
      return this
    }

    eq() {
      return this
    }

    order() {
      return this
    }

    then<TResult1 = { data: unknown[] | null; error: unknown }, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown[] | null; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      const result = this.table === failingTable
        ? { data: rowsByTable[this.table], error: { message: `${this.table} failed` } }
        : { data: rowsByTable[this.table], error: null }
      return Promise.resolve(result).then(onfulfilled, onrejected)
    }
  }

  const loaderDependencies: AppointmentOptionsLoaderDependencies = {
    getCurrentProfile: async () => profile,
    createClient: async () => ({
      from: (table: string) => new Query(table as TableName),
    }),
    logError: (context, error) => logCalls.push({ context, error }),
  }

  return { loaderDependencies, selections, logCalls }
}

test('returns one complete appointment option payload for an active admin', async () => {
  const { loaderDependencies } = dependencies()

  const result = await loadDashboardAppointmentOptions(loaderDependencies)

  assert.equal(result.ok, true)
  if (!result.ok) return
  if (!result.data.canViewPaymentSignals) assert.fail('expected an admin payload')
  const adminRate: number = result.data.appointmentTypes[0].session_rate
  assert.equal(adminRate, 800)
  assert.deepEqual(result.data, {
    patients: rowsByTable.patients,
    doctors: rowsByTable.doctors,
    assigneeOptions: rowsByTable.profiles,
    externalStaffOptions: rowsByTable.external_staff,
    appointmentTypes: rowsByTable.appointment_types,
    currentProfileId: 'admin-1',
    canManageExternalStaff: true,
    canViewPaymentSignals: true,
  })
})

test('rejects an unauthenticated user without issuing option queries', async () => {
  let createClientCalls = 0
  const { loaderDependencies } = dependencies({ profile: null })
  loaderDependencies.createClient = async () => {
    createClientCalls += 1
    throw new Error('must not create a client')
  }

  const result = await loadDashboardAppointmentOptions(loaderDependencies)

  assert.deepEqual(result, {
    ok: false,
    code: 'unauthorized',
    message: 'Unable to load appointment options.',
    retryable: false,
  })
  assert.equal(createClientCalls, 0)
})

test('rejects an inactive profile without issuing option queries', async () => {
  let createClientCalls = 0
  const { loaderDependencies } = dependencies({
    profile: { ...activeAdmin, status: 'blocked' },
  })
  loaderDependencies.createClient = async () => {
    createClientCalls += 1
    throw new Error('must not create a client')
  }

  const result = await loadDashboardAppointmentOptions(loaderDependencies)

  assert.deepEqual(result, {
    ok: false,
    code: 'unauthorized',
    message: 'Unable to load appointment options.',
    retryable: false,
  })
  assert.equal(createClientCalls, 0)
})

for (const table of Object.keys(rowsByTable) as TableName[]) {
  test(`returns an atomic retryable failure when the ${table} query fails`, async () => {
    const { loaderDependencies, logCalls } = dependencies({ failingTable: table })

    const result = await loadDashboardAppointmentOptions(loaderDependencies)

    assert.deepEqual(result, {
      ok: false,
      code: 'load_failed',
      message: 'Unable to load appointment options.',
      retryable: true,
    })
    assert.equal('data' in result, false)
    assert.equal(logCalls.length, 1)
    assert.match(logCalls[0].context, new RegExp(table))
  })
}

test('uses a staff-safe appointment type projection and omits payment-sensitive fields', async () => {
  const { loaderDependencies, selections } = dependencies({
    profile: { ...activeAdmin, id: 'staff-1', role: 'staff' },
  })

  const result = await loadDashboardAppointmentOptions(loaderDependencies)

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal('canViewPaymentSignals' in result, false)
  assert.equal(result.data.canViewPaymentSignals, false)
  assert.equal(result.data.canManageExternalStaff, false)
  if (result.data.canViewPaymentSignals) assert.fail('expected a staff-safe payload')
  const staffTypes: StaffAppointmentTypeOption[] = result.data.appointmentTypes
  // @ts-expect-error Staff payload types intentionally have no payment-sensitive session rate.
  void result.data.appointmentTypes[0]?.session_rate
  assert.doesNotMatch(selections.get('appointment_types') ?? '', /session_rate/)
  assert.deepEqual(staffTypes, [{
    id: 'type-1',
    clinic_id: 'clinic-1',
    name: 'Clinic Visit',
    is_shared: true,
    is_default: true,
    sort_order: 1,
    created_at: '2026-01-01T00:00:00Z',
  }])
})
