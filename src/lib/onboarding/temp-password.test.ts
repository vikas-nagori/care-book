import assert from 'node:assert/strict'
import { test } from 'node:test'

import { meetsInvitePasswordPolicy } from './invite-helpers.ts'
import { TEMP_PASSWORD_LENGTH, generateTempPassword } from './temp-password.ts'

test('generated temp passwords always satisfy the invite password policy', () => {
  for (let i = 0; i < 500; i++) {
    const password = generateTempPassword()
    assert.equal(password.length, TEMP_PASSWORD_LENGTH)
    assert.equal(meetsInvitePasswordPolicy(password), true, `policy failed for ${password}`)
  }
})

test('generated temp passwords avoid visually ambiguous characters', () => {
  for (let i = 0; i < 200; i++) {
    const password = generateTempPassword()
    assert.doesNotMatch(password, /[01IOlio]/)
  }
})

test('generated temp passwords are not repeated', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 200; i++) {
    seen.add(generateTempPassword())
  }
  assert.equal(seen.size, 200)
})

test('refuses lengths below the password policy minimum', () => {
  assert.throws(() => generateTempPassword(4))
})
