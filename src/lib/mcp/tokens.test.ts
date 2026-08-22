import assert from 'node:assert/strict'
import test from 'node:test'

import { generateClientId, generateToken, hashToken } from './tokens.ts'

test('tokens carry a type prefix and high entropy', () => {
  const token = generateToken('at')
  assert.match(token, /^cbk_at_[A-Za-z0-9_-]{43}$/)
  assert.notEqual(generateToken('at'), generateToken('at'))
})

test('prefixes distinguish token types', () => {
  assert.ok(generateToken('rt').startsWith('cbk_rt_'))
  assert.ok(generateToken('code').startsWith('cbk_code_'))
})

test('hashing is deterministic and peppered', () => {
  process.env.MCP_TOKEN_PEPPER = 'pepper-a'
  const token = generateToken('at')
  assert.equal(hashToken(token), hashToken(token))
  assert.notEqual(hashToken(token), token)
  process.env.MCP_TOKEN_PEPPER = 'pepper-b'
  assert.notEqual(hashToken(token), hashToken(token).replace(/./g, 'x'))
})

test('client ids are prefixed and unique', () => {
  assert.match(generateClientId(), /^cbk_client_[A-Za-z0-9_-]{22}$/)
  assert.notEqual(generateClientId(), generateClientId())
})
