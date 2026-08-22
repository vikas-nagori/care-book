import assert from 'node:assert/strict'
import test from 'node:test'

import { parseAuthorizeRequest } from './authorize-request.ts'

const client = {
  id: 'row-1',
  client_id: 'cbk_client_x',
  client_name: 'Chanakya',
  redirect_uris: ['https://pi.example.ts.net/cb'],
  token_endpoint_auth_method: 'none' as const,
  client_secret_hash: null,
  created_at: '2026-01-01T00:00:00Z',
}
const resource = 'https://care.example.com/api/mcp'

function params(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    response_type: 'code',
    client_id: 'cbk_client_x',
    redirect_uri: 'https://pi.example.ts.net/cb',
    state: 'st',
    code_challenge: 'abc',
    code_challenge_method: 'S256',
    resource,
    scope: 'read write:billing',
    ...overrides,
  })
}

test('a well-formed request parses', () => {
  const parsed = parseAuthorizeRequest(params(), client, resource)
  assert.equal(parsed.redirectUri, 'https://pi.example.ts.net/cb')
  assert.deepEqual(parsed.scopes, ['read', 'write:billing'])
})

test('unregistered redirects, plain PKCE, mismatched resources, and unsupported response types are rejected', () => {
  assert.throws(() => parseAuthorizeRequest(params({ redirect_uri: 'https://evil.test/cb' }), client, resource), /redirect_uri/)
  assert.throws(() => parseAuthorizeRequest(params({ code_challenge_method: 'plain' }), client, resource), /S256/)
  assert.throws(() => parseAuthorizeRequest(params({ resource: 'https://other.test/api/mcp' }), client, resource), /resource/)
  assert.throws(() => parseAuthorizeRequest(params({ response_type: 'token' }), client, resource), /response_type/)
})

test('requests with no supported scopes are rejected', () => {
  assert.throws(() => parseAuthorizeRequest(params({ scope: 'bogus' }), client, resource), /scope/)
})
