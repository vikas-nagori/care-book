import assert from 'node:assert/strict'
import test from 'node:test'

import { attemptFor, isRequestKey, newRequestKey } from './request-key.ts'

test('newRequestKey makes distinct v4 UUIDs', () => {
  const a = newRequestKey()
  const b = newRequestKey()
  assert.equal(isRequestKey(a), true)
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(a, b)
})

test('isRequestKey accepts only UUIDs', () => {
  assert.equal(isRequestKey('6F1C2A4E-8B7D-4C3A-9E2F-1A2B3C4D5E6F'), true)
  for (const value of [undefined, null, 42, '', 'abc', '6f1c2a4e-8b7d-4c3a-9e2f-1a2b3c4d5e6fx']) {
    assert.equal(isRequestKey(value), false, JSON.stringify(value))
  }
})

test('the same input keeps its request key; a changed input gets a new one', () => {
  let n = 0
  const make = () => `key-${++n}`
  const first = attemptFor(null, '{"amount":500}', make)
  assert.equal(first.key, 'key-1')
  assert.equal(attemptFor(first, '{"amount":500}', make), first)
  const changed = attemptFor(first, '{"amount":600}', make)
  assert.equal(changed.key, 'key-2')
})
