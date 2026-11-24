import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionNoteSections } from './session-note-sections.ts'

const blank = { subjective: null, objective: null, assessment: null, plan: null, exercises_prescribed: null }

test('a missing note or a note cleared of every field has no sections, so no card is drawn (G-17g)', () => {
  assert.deepEqual(sessionNoteSections(null), [])
  assert.deepEqual(sessionNoteSections(blank), [])
  assert.deepEqual(sessionNoteSections({ ...blank, plan: '   ', subjective: '' }), [])
})

test('an Objective-only note starts with Objective, so no divider sits above it (G-17g)', () => {
  assert.deepEqual(sessionNoteSections({ ...blank, objective: 'Knee flexion 110°' }), [{ label: 'Objective', text: 'Knee flexion 110°' }])
})

test('sections keep SOAP order and skip the blank ones', () => {
  const sections = sessionNoteSections({ ...blank, subjective: 'Less pain', plan: 'Review in a week', exercises_prescribed: 'Quad sets' })
  assert.deepEqual(sections.map((section) => section.label), ['Subjective', 'Plan', 'Exercises Prescribed'])
})
