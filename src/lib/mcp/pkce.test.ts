import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import { verifyCodeChallenge } from './pkce.ts'

function challengeFor(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

test('a matching S256 verifier is accepted', () => {
  const verifier = 'a'.repeat(64)
  assert.equal(verifyCodeChallenge(verifier, challengeFor(verifier)), true)
})

test('a mismatched verifier is rejected', () => {
  assert.equal(verifyCodeChallenge('a'.repeat(64), challengeFor('b'.repeat(64))), false)
})

test('the plain method is never accepted', () => {
  const verifier = 'a'.repeat(64)
  assert.equal(verifyCodeChallenge(verifier, verifier), false)
})

test('empty inputs are rejected', () => {
  assert.equal(verifyCodeChallenge('', ''), false)
})
