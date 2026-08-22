import assert from 'node:assert/strict'
import test from 'node:test'

import { rankByName, trigramSimilarity } from './fuzzy-match.ts'

const patients = [
  { id: 'p1', name: 'Aadi' },
  { id: 'p2', name: 'Aadi dadi' },
  { id: 'p3', name: 'Prajakta Kulkarni' },
  { id: 'p4', name: 'Sandeep Kumar Goyal' },
]

const search = (term: string) => rankByName(term, patients, (patient) => patient.name).map((scored) => scored.item.name)

test('an identical name scores 1', () => {
  assert.equal(trigramSimilarity('Aadi', 'aadi'), 1)
})

test('unrelated names score 0', () => {
  assert.equal(trigramSimilarity('Aadi', 'Zubin'), 0)
})

test('an exact name returns every other patient that also matches', () => {
  // The Aadi regression: both records must surface so the tool layer can insist on a choice.
  assert.deepEqual(search('Aadi'), ['Aadi', 'Aadi dadi'])
})

test('the exact match is ranked first', () => {
  assert.equal(search('Aadi')[0], 'Aadi')
})

test('a shortened name still finds the patient', () => {
  // A bare ilike '%Adi%' cannot match "Aadi" at all; trigram similarity can.
  assert.ok(search('Adi').includes('Aadi'), `expected "Aadi" for "Adi", got ${JSON.stringify(search('Adi'))}`)
})

test('a typo still finds the patient', () => {
  assert.ok(
    search('Prajkta').includes('Prajakta Kulkarni'),
    `expected a typo to match, got ${JSON.stringify(search('Prajkta'))}`
  )
})

test('a partial surname still finds the patient', () => {
  assert.ok(search('Kulkarni').includes('Prajakta Kulkarni'))
})

test('an unrelated term matches nothing', () => {
  assert.deepEqual(search('Zzzzzzz'), [])
})

test('an empty term matches nothing rather than everything', () => {
  assert.deepEqual(search('   '), [])
})

test('ordering is stable for equally scored names', () => {
  const duplicates = [{ id: 'b', name: 'Ravi Shah' }, { id: 'a', name: 'Ravi Shah' }]
  const ranked = rankByName('Ravi Shah', duplicates, (patient) => patient.name)
  assert.equal(ranked.length, 2)
  assert.ok(ranked.every((scored) => scored.score === 1))
})
