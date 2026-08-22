import assert from 'node:assert/strict'
import crypto from 'node:crypto'

const base = (process.env.MCP_CONFORMANCE_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const text = await response.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { response, body }
}

function b64url(value: Buffer) { return value.toString('base64url') }

async function main() {
  const challenge = await json(`${base}/api/mcp`)
  assert.equal(challenge.response.status, 401, 'GET /api/mcp must challenge unauthenticated clients')
  assert.match(challenge.response.headers.get('www-authenticate') ?? '', /resource_metadata=/)

  const protectedResource = await json(`${base}/.well-known/oauth-protected-resource`)
  assert.equal(protectedResource.response.status, 200)
  const resource = protectedResource.body as { resource: string; authorization_servers: string[] }
  assert.equal(resource.resource, `${base}/api/mcp`)

  const authorizationServer = await json(`${base}/.well-known/oauth-authorization-server`)
  assert.equal(authorizationServer.response.status, 200)
  const metadata = authorizationServer.body as { registration_endpoint: string; token_endpoint: string; authorization_endpoint: string }
  assert.equal(metadata.registration_endpoint, `${base}/oauth/register`)
  assert.equal(metadata.token_endpoint, `${base}/oauth/token`)

  const redirectUri = process.env.MCP_CONFORMANCE_REDIRECT_URI ?? 'http://127.0.0.1:8765/callback'
  const registration = await json(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_name: 'Care-Book conformance', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  })
  assert.equal(registration.response.status, 201)
  const client = registration.body as { client_id: string }

  const verifier = process.env.MCP_CONFORMANCE_CODE_VERIFIER ?? b64url(crypto.randomBytes(32))
  const codeChallenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const authorizationUrl = new URL(metadata.authorization_endpoint)
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('client_id', client.client_id)
  authorizationUrl.searchParams.set('redirect_uri', redirectUri)
  authorizationUrl.searchParams.set('code_challenge', codeChallenge)
  authorizationUrl.searchParams.set('code_challenge_method', 'S256')
  authorizationUrl.searchParams.set('resource', `${base}/api/mcp`)
  authorizationUrl.searchParams.set('scope', 'read')

  let accessToken = process.env.MCP_CONFORMANCE_ACCESS_TOKEN ?? ''
  let refreshToken = process.env.MCP_CONFORMANCE_REFRESH_TOKEN ?? ''
  const code = process.env.MCP_CONFORMANCE_AUTH_CODE
  if (code) {
    const token = await json(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: redirectUri, code_verifier: verifier, resource: `${base}/api/mcp` }),
    })
    assert.equal(token.response.status, 200)
    accessToken = (token.body as { access_token: string }).access_token
    refreshToken = (token.body as { refresh_token: string }).refresh_token
  }
  if (!accessToken && refreshToken) {
    const refreshed = await json(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: client.client_id, resource: `${base}/api/mcp` }),
    })
    assert.equal(refreshed.response.status, 200)
    accessToken = (refreshed.body as { access_token: string }).access_token
  }
  if (!accessToken) {
    console.log('OAuth discovery and DCR passed. Complete consent at:\n' + authorizationUrl.toString())
    console.log('Then rerun with MCP_CONFORMANCE_AUTH_CODE or MCP_CONFORMANCE_ACCESS_TOKEN.')
    return
  }

  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }
  const initialize = await json(`${base}/api/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'chanakya-agent-runner', version: '1' } } }) })
  assert.equal(initialize.response.status, 200)
  assert.equal((initialize.body as { result: { protocolVersion: string } }).result.protocolVersion, '2024-11-05')
  const initialized = await json(`${base}/api/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
  assert.equal(initialized.response.status, 202)
  const listed = await json(`${base}/api/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) })
  assert.equal(listed.response.status, 200)
  const tools = ((listed.body as { result: { tools: Array<{ name: string }> } }).result.tools ?? []).map((tool) => tool.name)
  assert.ok(tools.includes('carebook_whoami'))
  assert.ok(!tools.some((name) => name.includes('billing') || name.includes('payment') || name.includes('package')))
  const called = await json(`${base}/api/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'carebook_whoami', arguments: {} } }) })
  assert.equal(called.response.status, 200)
  assert.equal((called.body as { result: { isError: boolean } }).result.isError, false)
  console.log('MCP conformance passed: discovery, DCR, OAuth/token, refresh (when supplied), initialize, tools/list, tools/call.')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
