import assert from 'node:assert/strict'
import test from 'node:test'

import { safeReturnPath } from './return-url.ts'

test('a same-origin relative path is allowed', () => {
  assert.equal(safeReturnPath('/oauth/authorize?client_id=abc'), '/oauth/authorize?client_id=abc')
})

test('absolute, protocol-relative, and backslash-obscured hosts are rejected', () => {
  assert.equal(safeReturnPath('https://evil.test/steal'), null)
  assert.equal(safeReturnPath('//evil.test/steal'), null)
  assert.equal(safeReturnPath('/\\evil.test'), null)
})
