import { MAX_PATIENT_AGE, clinicToday, patientAge, type PatientAgeFields, type PatientAgeSource } from '../patients/age.ts'
import { ToolError } from './errors.ts'

export const AGE_PROP_DESCRIPTION = `Optional age in whole years (0-${MAX_PATIENT_AGE})`

/** Columns to store for an `age` tool argument. Throws a ToolError for anything but whole years 0–120. */
export function toolAgeFields(value: unknown, field = 'age', today: string = clinicToday()): PatientAgeFields {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return { age_years: null, age_recorded_on: null }
  const age = typeof value === 'string' && /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : value
  if (typeof age !== 'number' || !Number.isInteger(age) || age < 0 || age > MAX_PATIENT_AGE) {
    throw new ToolError(`${field} must be a whole number of years between 0 and ${MAX_PATIENT_AGE}.`)
  }
  return { age_years: age, age_recorded_on: today }
}

/** Replace the raw age columns on a patient row with the computed `age` a caller should read. */
export function withComputedAge<T extends PatientAgeSource>(patient: T, today: string = clinicToday()) {
  const rest: Record<string, unknown> = { ...patient }
  delete rest.age_years
  delete rest.age_recorded_on
  return { ...(rest as Omit<T, 'age_years' | 'age_recorded_on'>), age: patientAge(patient, today) }
}
