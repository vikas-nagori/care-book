import assert from 'node:assert/strict'
import test from 'node:test'

import { decryptSecret, encryptSecret } from './session-crypto.ts'

test('encrypted refresh secrets round-trip without exposing plaintext', () => {
  process.env.MCP_SESSION_ENCRYPTION_KEY = 'k'.repeat(32)
  const encrypted = encryptSecret('refresh-token-value')
  assert.notEqual(encrypted.ciphertext, 'refresh-token-value')
  assert.equal(decryptSecret(encrypted), 'refresh-token-value')
})

test('tampered ciphertext is rejected', () => {
  process.env.MCP_SESSION_ENCRYPTION_KEY = 'k'.repeat(32)
  const encrypted = encryptSecret('refresh-token-value')
  assert.throws(
    () => decryptSecret({ ...encrypted, ciphertext: `${encrypted.ciphertext}x` }),
    /decrypt|authenticate/i
  )
})

test('missing encryption key fails loudly', () => {
  delete process.env.MCP_SESSION_ENCRYPTION_KEY
  assert.throws(() => encryptSecret('secret'), /MCP_SESSION_ENCRYPTION_KEY/)
})
