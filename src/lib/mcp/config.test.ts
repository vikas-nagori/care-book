import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MCP_SCOPES,
  isMcpEnabled,
  mcpIssuer,
  mcpOrigin,
  mcpResourceUrl,
  parseScopes,
} from './config.ts'

test('origin strips a trailing slash', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://care.example.com/'
  assert.equal(mcpOrigin(), 'https://care.example.com')
})

test('resource URL is the MCP endpoint under the origin', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://care.example.com'
  assert.equal(mcpResourceUrl(), 'https://care.example.com/api/mcp')
  assert.equal(mcpIssuer(), 'https://care.example.com')
})

test('missing site URL is a hard failure', () => {
  delete process.env.NEXT_PUBLIC_SITE_URL
  assert.throws(() => mcpOrigin(), /NEXT_PUBLIC_SITE_URL/)
})

test('the feature is off unless explicitly enabled', () => {
  delete process.env.MCP_ENABLED
  assert.equal(isMcpEnabled(), false)
  process.env.MCP_ENABLED = 'true'
  assert.equal(isMcpEnabled(), true)
})

test('parseScopes keeps only known scopes and de-duplicates', () => {
  assert.deepEqual(parseScopes('read read write:billing bogus'), ['read', 'write:billing'])
  assert.deepEqual(parseScopes(''), [])
  assert.deepEqual(parseScopes(undefined), [])
})

test('declared scopes are stable', () => {
  assert.deepEqual(MCP_SCOPES, ['read', 'write:clinical', 'write:billing'])
})
