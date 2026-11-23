import assert from 'node:assert/strict'
import test from 'node:test'
import { quoteFilterValue } from './postgrest-filter.ts'

test('quoteFilterValue wraps values so filter punctuation stays inside the value', () => {
  assert.equal(quoteFilterValue('a.b@example.com'), '"a.b@example.com"')
  assert.equal(quoteFilterValue('x,role.eq.admin'), '"x,role.eq.admin"')
  assert.equal(quoteFilterValue('say "hi"\\'), '"say \\"hi\\"\\\\"')
})
