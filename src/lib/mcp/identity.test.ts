import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import { mintSupabaseUserJwt } from './identity.ts'

function decode(jwt: string) {
  const [header, payload] = jwt.split('.')
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as Record<string, unknown>,
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>,
  }
}

test('the minted token carries Supabase authenticated claims', () => {
  process.env.SUPABASE_JWT_SECRET = 'test-secret'
  const jwt = mintSupabaseUserJwt({ userId: 'user-1', email: 'a@b.test' })
  const { header, payload } = decode(jwt)

  assert.equal(header.alg, 'HS256')
  assert.equal(payload.sub, 'user-1')
  assert.equal(payload.role, 'authenticated')
  assert.equal(payload.aud, 'authenticated')
  assert.equal(payload.email, 'a@b.test')
})

test('the token expires within a minute by default', () => {
  process.env.SUPABASE_JWT_SECRET = 'test-secret'
  const { payload } = decode(mintSupabaseUserJwt({ userId: 'user-1', email: 'a@b.test' }))
  assert.equal((payload.exp as number) - (payload.iat as number), 60)
})

test('the signature verifies against the configured secret', () => {
  process.env.SUPABASE_JWT_SECRET = 'test-secret'
  const jwt = mintSupabaseUserJwt({ userId: 'user-1', email: 'a@b.test' })
  const [header, payload, signature] = jwt.split('.')
  const expected = crypto.createHmac('sha256', 'test-secret').update(`${header}.${payload}`).digest('base64url')
  assert.equal(signature, expected)
})

test('a missing secret fails loudly', () => {
  delete process.env.SUPABASE_JWT_SECRET
  assert.throws(() => mintSupabaseUserJwt({ userId: 'user-1', email: 'a@b.test' }), /SUPABASE_JWT_SECRET/)
})
