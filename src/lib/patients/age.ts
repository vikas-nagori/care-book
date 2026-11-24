// Patient age in whole years.
//
// Patients carry two optional sources of age: the legacy `dob` (exact date of birth, never
// rewritten except deleted when someone empties the Age field; see ageFieldsForSave) and `age_years` + `age_recorded_on` (an age typed on the patient form, plus the IST
// day it was typed). An entered age wins and grows by the whole years elapsed since it was
// recorded, so it stays right over time; otherwise the age comes from the date of birth.

import { CLINIC_TIME_ZONE, getZonedDate } from '../timezone.ts'

export const MAX_PATIENT_AGE = 120

export type PatientAgeSource = {
  dob?: string | null
  age_years?: number | null
  age_recorded_on?: string | null
}

export type PatientAgeFields = { age_years: number | null; age_recorded_on: string | null }

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

function parseDateKey(value: string) {
  const match = DATE_KEY.exec(value)
  if (!match) throw new RangeError(`Invalid calendar date: ${value}`)
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError(`Invalid calendar date: ${value}`)
  }
  return { year, month, day }
}

/** Whole years from `from` to `to` (yyyy-MM-dd). A year counts once its anniversary is reached. */
export function fullYearsBetween(from: string, to: string): number {
  const start = parseDateKey(from)
  const end = parseDateKey(to)
  const beforeAnniversary = end.month < start.month || (end.month === start.month && end.day < start.day)
  return Math.max(0, end.year - start.year - (beforeAnniversary ? 1 : 0))
}

/** Today's calendar date in the clinic's time zone (IST). */
export function clinicToday(now: Date = new Date()): string {
  return getZonedDate(now, CLINIC_TIME_ZONE)
}

/** The patient's age on `today`, or null when it is unknown. Never throws on bad stored data. */
export function patientAge(patient: PatientAgeSource, today: string = clinicToday()): number | null {
  try {
    if (patient.age_years != null && patient.age_recorded_on) {
      return patient.age_years + fullYearsBetween(patient.age_recorded_on, today)
    }
    if (patient.dob) return fullYearsBetween(patient.dob, today)
  } catch {
    return null
  }
  return null
}

export type AgeInputResult = { ok: true; age: number | null } | { ok: false; message: string }

/** Parse the Age field: blank means unknown; otherwise a whole number of years, 0–120. */
export function parseAgeInput(raw: string | null | undefined): AgeInputResult {
  const value = (raw ?? '').trim()
  if (!value) return { ok: true, age: null }
  if (!/^\d{1,3}$/.test(value)) return { ok: false, message: `Age must be a whole number between 0 and ${MAX_PATIENT_AGE}.` }
  const age = Number(value)
  if (age > MAX_PATIENT_AGE) return { ok: false, message: `Age must be a whole number between 0 and ${MAX_PATIENT_AGE}.` }
  return { ok: true, age }
}

/** Columns an edit may write for the Age field. `dob` is only ever written as null (see below). */
export type PatientAgeWrite = Partial<PatientAgeFields> & { dob?: null }

/**
 * The age columns to write when a patient is saved with `age` in the form.
 *
 * Returns `{}` when the shown age did not change, so a date of birth keeps driving the age and an
 * earlier entry keeps its anniversary. A corrected age is stored beside the date of birth, which
 * stays untouched.
 *
 * The one exception (owner decision D4a, change C-1): an edit that empties an Age that was shown
 * also deletes the date of birth, or patientAge() would fall back to it and the age would come
 * straight back. A new patient never sends `dob`.
 */
export function ageFieldsForSave(
  age: number | null,
  existing: PatientAgeSource | null,
  today: string = clinicToday(),
): PatientAgeWrite {
  if (existing && patientAge(existing, today) === age) return {}
  if (age !== null) return { age_years: age, age_recorded_on: today }
  return existing
    ? { age_years: null, age_recorded_on: null, dob: null }
    : { age_years: null, age_recorded_on: null }
}

export function formatAge(age: number): string {
  return `${age} ${age === 1 ? 'year' : 'years'}`
}
