import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clampTutorialStepIndex,
  getTutorialProgress,
  getTutorialSteps,
} from './tutorial-steps.ts'

test('staff tutorial includes the shared daily workflow in order', () => {
  assert.deepEqual(
    getTutorialSteps('staff').map((step) => step.id),
    ['welcome', 'dashboard', 'schedule', 'patients', 'session-workflow', 'finish']
  )
})

test('admin tutorial adds billing and clinic setup before finish', () => {
  assert.deepEqual(
    getTutorialSteps('admin').map((step) => step.id),
    [
      'welcome',
      'dashboard',
      'schedule',
      'patients',
      'session-workflow',
      'billing',
      'clinic-setup',
      'finish',
    ]
  )
})

test('staff tutorial never exposes admin destinations or billing copy', () => {
  const steps = getTutorialSteps('staff')
  const serialized = JSON.stringify(steps).toLowerCase()

  assert.doesNotMatch(serialized, /billing|payment|package|invite/)
  assert.equal(
    steps.some((step) =>
      step.actions?.some((action) => action.href === '/billing')
    ),
    false
  )
})

test('every tutorial step has practical content and valid internal destinations', () => {
  for (const role of ['admin', 'staff'] as const) {
    for (const step of getTutorialSteps(role)) {
      assert.ok(step.title.trim())
      assert.ok(step.description.trim())
      assert.ok(step.checklist.length > 0)
      for (const action of step.actions ?? []) {
        assert.match(action.href, /^\//)
        assert.ok(action.label.trim())
      }
    }
  }
})

test('tutorial step index stays inside the available range', () => {
  assert.equal(clampTutorialStepIndex(-1, 6), 0)
  assert.equal(clampTutorialStepIndex(2, 6), 2)
  assert.equal(clampTutorialStepIndex(20, 6), 5)
  assert.equal(clampTutorialStepIndex(2, 0), 0)
})

test('tutorial progress reports a one-based percentage', () => {
  assert.equal(getTutorialProgress(0, 6), 100 / 6)
  assert.equal(getTutorialProgress(5, 6), 100)
  assert.equal(getTutorialProgress(0, 0), 0)
})

test('tutorial builders do not share mutable step data between calls', () => {
  const first = getTutorialSteps('staff')
  first[0].checklist.push('Unexpected mutation')
  first[1].actions?.push({ href: '/unexpected', label: 'Unexpected' })

  const second = getTutorialSteps('staff')
  assert.equal(second[0].checklist.includes('Unexpected mutation'), false)
  assert.equal(second[1].actions?.some((action) => action.href === '/unexpected'), false)
})
