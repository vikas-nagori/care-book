import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolError } from './errors.ts'
import { toolAgeFields, withComputedAge } from './patient-age.ts'

test('a missing or blank age stores nothing', () => {
  for (const value of [undefined, null, '', '  ']) {
    assert.deepEqual(toolAgeFields(value, 'age', '2026-11-24'), { age_years: null, age_recorded_on: null })
  }
})

test('an age in whole years is recorded against today, as a number or numeric text', () => {
  assert.deepEqual(toolAgeFields(42, 'age', '2026-11-24'), { age_years: 42, age_recorded_on: '2026-11-24' })
  assert.deepEqual(toolAgeFields(' 7 ', 'age', '2026-11-24'), { age_years: 7, age_recorded_on: '2026-11-24' })
  assert.deepEqual(toolAgeFields(0, 'age', '2026-11-24'), { age_years: 0, age_recorded_on: '2026-11-24' })
})

test('fractions, negatives, words and ages over 120 are refused with the field name', () => {
  for (const value of [-1, 121, 4.5, 'forty', '4.5', true, {}]) {
    assert.throws(() => toolAgeFields(value, 'new_patient.age', '2026-11-24'), (error: unknown) =>
      error instanceof ToolError && /new_patient\.age .*0 and 120/.test(error.message))
  }
})

test('patient output carries a computed age instead of the raw age columns', () => {
  assert.deepEqual(withComputedAge({ name: 'A', dob: null, age_years: 40, age_recorded_on: '2025-11-24' }, '2026-11-24'),
    { name: 'A', dob: null, age: 41 })
  assert.deepEqual(withComputedAge({ name: 'B', dob: '1990-03-10', age_years: null, age_recorded_on: null }, '2026-11-24'),
    { name: 'B', dob: '1990-03-10', age: 36 })
  assert.deepEqual(withComputedAge({ name: 'C', dob: null, age_years: null, age_recorded_on: null }, '2026-11-24'),
    { name: 'C', dob: null, age: null })
})
