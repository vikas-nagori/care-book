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
