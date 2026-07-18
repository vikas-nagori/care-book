import test from 'node:test'
import assert from 'node:assert/strict'
import { getTutorialSteps } from './tutorial-steps.ts'

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
