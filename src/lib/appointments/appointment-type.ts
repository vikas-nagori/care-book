import type { AppointmentType, CreateAppointmentTypeInput } from '../supabase/types'

export type { AppointmentType }

// Types are now per-clinic data (see appointment_types table / migration 028).
// The appointment's denormalized `type` label is stored on the row, so display
// code reads `appointment.type` directly; these helpers operate on the fetched
// list for forms, filters, and Settings CRUD.

export function sortAppointmentTypes(types: AppointmentType[]): AppointmentType[] {
  return [...types].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  )
}

// The type selected by default in the booking form: the first shared default,
// else the first type by sort order.
export function defaultAppointmentType(types: AppointmentType[]): AppointmentType | null {
  const sorted = sortAppointmentTypes(types)
  return sorted.find((type) => type.is_shared) ?? sorted[0] ?? null
}

type ValidationFailure = {
  success: false
  errorCode: string
  message: string
}

type ValidationSuccess = {
  success: true
  values: {
    name: string
    sessionRate: number
    isShared: boolean
  }
}

export function validateAppointmentTypeInput(
  input: CreateAppointmentTypeInput,
): ValidationSuccess | ValidationFailure {
  const name = input.name.trim()
  if (!name) {
    return {
      success: false,
      errorCode: 'APPOINTMENT_TYPE_NAME_REQUIRED',
      message: 'Enter an appointment type name.',
    }
  }

  if (!Number.isFinite(input.sessionRate) || input.sessionRate < 0) {
    return {
      success: false,
      errorCode: 'APPOINTMENT_TYPE_INVALID_RATE',
      message: 'Session rate must be zero or more.',
    }
  }

  return {
    success: true,
    values: {
      name,
      sessionRate: input.sessionRate,
      isShared: input.isShared,
    },
  }
}
