import { getRestrictedUiAccess } from '../access/restricted-visibility.ts'
import type {
  AppointmentAssigneeOption,
  AppointmentType,
  Doctor,
  ExternalStaff,
  Profile,
} from '../supabase/types'

export type DashboardPatientOption = {
  id: string
  name: string
}

export type StaffAppointmentTypeOption = Pick<
  AppointmentType,
  'id' | 'clinic_id' | 'name' | 'is_shared' | 'is_default' | 'sort_order' | 'created_at'
>

export type DashboardAppointmentTypeOption = AppointmentType | StaffAppointmentTypeOption

type DashboardAppointmentOptionsBase = {
  patients: DashboardPatientOption[]
  doctors: Doctor[]
  assigneeOptions: AppointmentAssigneeOption[]
  externalStaffOptions: ExternalStaff[]
  currentProfileId: string
}

export type DashboardAppointmentOptions = DashboardAppointmentOptionsBase & (
  | {
      appointmentTypes: AppointmentType[]
      canManageExternalStaff: true
      canViewPaymentSignals: true
    }
  | {
      appointmentTypes: StaffAppointmentTypeOption[]
      canManageExternalStaff: false
      canViewPaymentSignals: false
    }
)

export type DashboardAppointmentOptionsResult =
  | { ok: true; data: DashboardAppointmentOptions }
  | {
      ok: false
      code: 'unauthorized' | 'load_failed'
      message: 'Unable to load appointment options.'
      retryable: boolean
    }

type QueryResult = {
  data: unknown[] | null
  error: unknown
}

export type AppointmentOptionsQuery = PromiseLike<QueryResult> & {
  select(columns: string): AppointmentOptionsQuery
  eq(column: string, value: unknown): AppointmentOptionsQuery
  order(column: string): AppointmentOptionsQuery
}

export type AppointmentOptionsDataClient = {
  from(table: string): AppointmentOptionsQuery
}

export type AppointmentOptionsLoaderDependencies = {
  getCurrentProfile: () => Promise<Profile | null>
  createClient: () => Promise<AppointmentOptionsDataClient>
  logError: (context: string, error: unknown, meta?: Record<string, unknown>) => void
}

const GENERIC_MESSAGE = 'Unable to load appointment options.' as const

function retryableFailure(): DashboardAppointmentOptionsResult {
  return {
    ok: false,
    code: 'load_failed',
    message: GENERIC_MESSAGE,
    retryable: true,
  }
}

function staffAppointmentType(row: unknown): StaffAppointmentTypeOption {
  const type = row as AppointmentType
  return {
    id: type.id,
    clinic_id: type.clinic_id,
    name: type.name,
    is_shared: type.is_shared,
    is_default: type.is_default,
    sort_order: type.sort_order,
    created_at: type.created_at,
  }
}

export async function loadDashboardAppointmentOptions(
  dependencies: AppointmentOptionsLoaderDependencies,
): Promise<DashboardAppointmentOptionsResult> {
  try {
    const profile = await dependencies.getCurrentProfile()
    if (!profile || profile.status !== 'active') {
      return {
        ok: false,
        code: 'unauthorized',
        message: GENERIC_MESSAGE,
        retryable: false,
      }
    }

    const access = getRestrictedUiAccess(profile)
    const client = await dependencies.createClient()
    const appointmentTypeColumns = access.canViewPaymentSignals
      ? '*'
      : 'id, clinic_id, name, is_shared, is_default, sort_order, created_at'

    const results = await Promise.all([
      client.from('patients').select('id, name').order('name'),
      client.from('doctors').select('*').order('name'),
      client
        .from('profiles')
        .select('id, full_name, email, role')
        .eq('status', 'active')
        .order('full_name'),
      client
        .from('external_staff')
        .select('id, clinic_id, name, phone, email, notes, status, linked_profile_id, created_by, created_at, updated_at')
        .order('name'),
      client.from('appointment_types').select(appointmentTypeColumns).order('sort_order'),
    ])

    const queryNames = [
      'patients',
      'doctors',
      'profiles',
      'external_staff',
      'appointment_types',
    ] as const
    let failed = false

    results.forEach((result, index) => {
      if (!result.error) return
      failed = true
      dependencies.logError(
        `DashboardAppointmentOptions/${queryNames[index]}`,
        result.error,
        { profileId: profile.id },
      )
    })

    if (failed) return retryableFailure()

    const [patients, doctors, assignees, externalStaff, appointmentTypes] = results

    const sharedOptions: DashboardAppointmentOptionsBase = {
      patients: (patients.data ?? []) as DashboardPatientOption[],
      doctors: (doctors.data ?? []) as Doctor[],
      assigneeOptions: (assignees.data ?? []) as AppointmentAssigneeOption[],
      externalStaffOptions: (externalStaff.data ?? []) as ExternalStaff[],
      currentProfileId: profile.id,
    }

    if (access.canViewPaymentSignals) {
      return {
        ok: true,
        data: {
          ...sharedOptions,
          appointmentTypes: (appointmentTypes.data ?? []) as AppointmentType[],
          canManageExternalStaff: true,
          canViewPaymentSignals: true,
        },
      }
    }

    return {
      ok: true,
      data: {
        ...sharedOptions,
        appointmentTypes: (appointmentTypes.data ?? []).map(staffAppointmentType),
        canManageExternalStaff: false,
        canViewPaymentSignals: false,
      },
    }
  } catch (error) {
    dependencies.logError('DashboardAppointmentOptions/unexpected', error)
    return retryableFailure()
  }
}
