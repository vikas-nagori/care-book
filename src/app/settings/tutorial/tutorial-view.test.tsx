import test from 'node:test'
import assert from 'node:assert/strict'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { getTutorialSteps } from '@/lib/tutorial/tutorial-steps'
import { TutorialView } from './tutorial-view'

Object.assign(globalThis, { self: globalThis })

function getText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : getText(child)))
    .join('')
}

function findButton(root: ReactTestInstance, label: string) {
  const button = root
    .findAllByType('button')
    .find((candidate) => getText(candidate).includes(label))

  assert.ok(button, `Expected a button labeled ${label}`)
  return button
}

test('staff tutorial advances, announces each step, finishes, and restarts', () => {
  const steps = getTutorialSteps('staff')
  const renderer = create(<TutorialView steps={steps} />)
  const root = renderer.root

  assert.equal(root.findByProps({ role: 'progressbar' }).props['aria-valuenow'], 1)
  assert.match(getText(root), /Your clinic day, in one place/)

  act(() => findButton(root, 'Next').props.onClick())

  assert.equal(root.findByProps({ role: 'progressbar' }).props['aria-valuenow'], 2)
  assert.equal(
    getText(root.findByProps({ 'aria-live': 'polite' })),
    'Step 2 of 6: See what needs attention today'
  )

  act(() => findButton(root, 'Back').props.onClick())
  assert.equal(root.findByProps({ role: 'progressbar' }).props['aria-valuenow'], 1)

  act(() => findButton(root, 'Next').props.onClick())

  for (let index = 2; index < steps.length; index += 1) {
    act(() => findButton(root, 'Next').props.onClick())
  }

  assert.equal(root.findByProps({ role: 'progressbar' }).props['aria-valuenow'], 6)
  assert.ok(root.findAllByProps({ href: '/settings' }).some((link) => getText(link) === 'Finish'))
  assert.ok(root.findAllByProps({ href: '/schedule' }).length > 0)
  assert.ok(root.findAllByProps({ href: '/patients' }).length > 0)

  act(() => findButton(root, 'Start again').props.onClick())

  assert.equal(root.findByProps({ role: 'progressbar' }).props['aria-valuenow'], 1)
  assert.match(getText(root), /Your clinic day, in one place/)
})

test('tutorial renders a safe fallback when no steps are available', () => {
  const renderer = create(<TutorialView steps={[]} />)
  const root = renderer.root

  assert.match(getText(root), /Tutorial unavailable/)
  assert.ok(root.findAllByProps({ href: '/settings' }).length > 0)
  assert.equal(root.findAllByProps({ role: 'progressbar' }).length, 0)
})
