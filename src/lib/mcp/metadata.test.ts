import assert from 'node:assert/strict'
import test from 'node:test'

import { authorizationServerMetadata, protectedResourceMetadata } from './metadata.ts'

test('protected resource metadata points at this origin as the AS', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://care.example.com'
  const meta = protectedResourceMetadata()
  assert.equal(meta.resource, 'https://care.example.com/api/mcp')
  assert.deepEqual(meta.authorization_servers, ['https://care.example.com'])
  assert.deepEqual(meta.bearer_methods_supported, ['header'])
})

test('AS metadata advertises a public PKCE-only client', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://care.example.com'
  const meta = authorizationServerMetadata()
  assert.deepEqual(meta.token_endpoint_auth_methods_supported, ['none'])
  assert.deepEqual(meta.code_challenge_methods_supported, ['S256'])
})

test('AS metadata carries the OAuth endpoints', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://care.example.com'
  const meta = authorizationServerMetadata()
  assert.equal(meta.authorization_endpoint, 'https://care.example.com/oauth/authorize')
  assert.equal(meta.token_endpoint, 'https://care.example.com/oauth/token')
  assert.equal(meta.registration_endpoint, 'https://care.example.com/oauth/register')
  assert.equal(meta.revocation_endpoint, 'https://care.example.com/oauth/revoke')
  assert.deepEqual(meta.grant_types_supported, ['authorization_code', 'refresh_token'])
})
