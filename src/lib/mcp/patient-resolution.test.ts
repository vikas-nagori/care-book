import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyPatientMatches, normalizePatientName } from './patient-resolution.ts'

const patient = (id: string, name: string) => ({ id, name, phone: '9876543210', dob: '1990-01-01' })

test('normalization makes exact name matching case and whitespace insensitive', () => {
  assert.equal(normalizePatientName('  Priya   Sharma '), 'priya sharma')
})

test('one exact match is selected automatically', () => {
  assert.deepEqual(classifyPatientMatches('Priya Sharma', [patient('p1', 'Priya Sharma')]), {
    kind: 'selected',
    patient: patient('p1', 'Priya Sharma'),
  })
})

test('multiple exact matches require confirmation', () => {
  const matches = [patient('p1', 'Priya Sharma'), patient('p2', 'Priya Sharma')]
  assert.deepEqual(classifyPatientMatches('Priya Sharma', matches), { kind: 'ambiguous', candidates: matches })
})

test('a partial match requires confirmation rather than auto-selecting', () => {
  assert.equal(classifyPatientMatches('Priya', [patient('p1', 'Priya Sharma')]).kind, 'ambiguous')
})

test('no matches are reported distinctly', () => {
  assert.deepEqual(classifyPatientMatches('Unknown', []), { kind: 'none' })
})

test('an exact match never suppresses the other candidates it was found alongside', () => {
  // The Aadi regression: "Aadi" and "Aadi dadi" both match a search for "Aadi", and the exact hit
  // used to be selected silently, so every booking went to the first record with no prompt.
  const exact = patient('p1', 'Aadi')
  const near = patient('p2', 'Aadi dadi')
  const result = classifyPatientMatches('Aadi', [exact, near])

  assert.equal(result.kind, 'ambiguous')
  assert.deepEqual(result.kind === 'ambiguous' ? result.candidates : [], [exact, near])
})

test('exact matches are ordered ahead of near matches', () => {
  const near = patient('p2', 'Aadi dadi')
  const exact = patient('p1', 'Aadi')
  const result = classifyPatientMatches('Aadi', [near, exact])

  assert.deepEqual(result.kind === 'ambiguous' ? result.candidates.map((c) => c.id) : [], ['p1', 'p2'])
})
