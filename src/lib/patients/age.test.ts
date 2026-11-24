import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_PATIENT_AGE,
  ageFieldsForSave,
  clinicToday,
  formatAge,
  fullYearsBetween,
  parseAgeInput,
  patientAge,
} from './age.ts'

test('fullYearsBetween counts a year only once the anniversary is reached', () => {
  assert.equal(fullYearsBetween('1990-03-10', '2026-03-09'), 35)
  assert.equal(fullYearsBetween('1990-03-10', '2026-03-10'), 36)
  assert.equal(fullYearsBetween('1990-03-10', '2026-12-31'), 36)
  assert.equal(fullYearsBetween('2026-11-24', '2026-11-24'), 0)
})

test('fullYearsBetween treats a 29 February start as reached on 1 March in common years', () => {
  assert.equal(fullYearsBetween('2000-02-29', '2027-02-28'), 26)
  assert.equal(fullYearsBetween('2000-02-29', '2027-03-01'), 27)
  assert.equal(fullYearsBetween('2000-02-29', '2028-02-29'), 28)
})

test('fullYearsBetween never goes negative for a date in the future', () => {
  assert.equal(fullYearsBetween('2030-01-01', '2026-11-24'), 0)
})

test('fullYearsBetween rejects malformed date keys', () => {
  assert.throws(() => fullYearsBetween('10-03-1990', '2026-11-24'), RangeError)
  assert.throws(() => fullYearsBetween('1990-02-30', '2026-11-24'), RangeError)
})

test('patientAge is null when neither an age nor a date of birth is known', () => {
  assert.equal(patientAge({}, '2026-11-24'), null)
  assert.equal(patientAge({ dob: null, age_years: null, age_recorded_on: null }, '2026-11-24'), null)
})

test('patientAge derives whole years from a stored date of birth', () => {
  assert.equal(patientAge({ dob: '1990-03-10' }, '2026-11-24'), 36)
  assert.equal(patientAge({ dob: '1990-12-01' }, '2026-11-24'), 35)
})

test('patientAge ages an entered age by the whole years elapsed since it was recorded', () => {
  const patient = { age_years: 40, age_recorded_on: '2026-11-24' }
  assert.equal(patientAge(patient, '2026-11-24'), 40)
  assert.equal(patientAge(patient, '2027-11-23'), 40)
  assert.equal(patientAge(patient, '2027-11-24'), 41)
  assert.equal(patientAge(patient, '2036-11-24'), 50)
})

test('an entered age takes precedence over a stored date of birth', () => {
  assert.equal(patientAge({ dob: '1990-03-10', age_years: 50, age_recorded_on: '2026-11-24' }, '2026-11-24'), 50)
})

test('an age without its recorded date falls back to the date of birth', () => {
  assert.equal(patientAge({ dob: '1990-03-10', age_years: 50, age_recorded_on: null }, '2026-11-24'), 36)
  assert.equal(patientAge({ age_years: 50, age_recorded_on: null }, '2026-11-24'), null)
})

test('a malformed stored date yields no age instead of crashing the screen', () => {
  assert.equal(patientAge({ dob: 'not-a-date' }, '2026-11-24'), null)
  assert.equal(patientAge({ age_years: 30, age_recorded_on: 'garbage' }, '2026-11-24'), null)
})

test('parseAgeInput accepts blank as unknown and whole years from 0 to 120', () => {
  assert.deepEqual(parseAgeInput(''), { ok: true, age: null })
  assert.deepEqual(parseAgeInput('   '), { ok: true, age: null })
  assert.deepEqual(parseAgeInput(null), { ok: true, age: null })
  assert.deepEqual(parseAgeInput('0'), { ok: true, age: 0 })
  assert.deepEqual(parseAgeInput(' 42 '), { ok: true, age: 42 })
  assert.deepEqual(parseAgeInput('007'), { ok: true, age: 7 })
  assert.deepEqual(parseAgeInput(String(MAX_PATIENT_AGE)), { ok: true, age: 120 })
})

test('parseAgeInput rejects fractions, negatives, words and ages over 120', () => {
  for (const raw of ['-1', '121', '4.5', '1e2', 'forty', '42 years', '0x10']) {
    const result = parseAgeInput(raw)
    assert.equal(result.ok, false, raw)
    if (!result.ok) assert.match(result.message, /0 and 120/)
  }
})

test('ageFieldsForSave records a new patient age against today', () => {
  assert.deepEqual(ageFieldsForSave(42, null, '2026-11-24'), { age_years: 42, age_recorded_on: '2026-11-24' })
  assert.deepEqual(ageFieldsForSave(null, null, '2026-11-24'), { age_years: null, age_recorded_on: null })
})

test('ageFieldsForSave writes nothing when an edit leaves the shown age unchanged', () => {
  // A date of birth keeps driving the age, and an earlier entry keeps its anniversary.
  assert.deepEqual(ageFieldsForSave(36, { dob: '1990-03-10' }, '2026-11-24'), {})
  assert.deepEqual(ageFieldsForSave(41, { age_years: 40, age_recorded_on: '2025-06-01' }, '2026-11-24'), {})
  assert.deepEqual(ageFieldsForSave(null, {}, '2026-11-24'), {})
})

test('ageFieldsForSave records a changed age and never touches the date of birth', () => {
  const fields = ageFieldsForSave(50, { dob: '1990-03-10' }, '2026-11-24')
  assert.deepEqual(fields, { age_years: 50, age_recorded_on: '2026-11-24' })
  assert.equal('dob' in fields, false)
})

test('ageFieldsForSave clears an entered age when the field is blanked', () => {
  assert.deepEqual(ageFieldsForSave(null, { age_years: 40, age_recorded_on: '2025-06-01' }, '2026-11-24'), { age_years: null, age_recorded_on: null })
})

test('formatAge reads naturally for one year and for many', () => {
  assert.equal(formatAge(1), '1 year')
  assert.equal(formatAge(0), '0 years')
  assert.equal(formatAge(42), '42 years')
})

test('clinicToday is the IST calendar date', () => {
  // 20:00 UTC on 24 Nov is already 01:30 on 25 Nov in India.
  assert.equal(clinicToday(new Date('2026-11-24T20:00:00Z')), '2026-11-25')
  assert.equal(clinicToday(new Date('2026-11-24T10:00:00Z')), '2026-11-24')
})
