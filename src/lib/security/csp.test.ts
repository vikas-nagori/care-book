import assert from 'node:assert/strict'
import test from 'node:test'

import nextConfig from '../../../next.config.mjs'
import { buildConnectSrc, buildContentSecurityPolicy, createCspNonce } from './csp.ts'

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> }

// `headers` is optional on NextConfig; the whole point of these tests is that it is configured.
async function configuredHeaders(): Promise<HeaderRule[]> {
  assert.ok(nextConfig.headers, 'next.config.mjs should configure headers()')
  return (await nextConfig.headers()) as HeaderRule[]
}

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split('; ').map((directive) => {
      const [name, ...values] = directive.split(' ')
      return [name, values.join(' ')]
    })
  )
}

test('document policy contains no unsafe script sources', () => {
  const policy = buildContentSecurityPolicy({ nonce: 'abc123' })
  const scriptSrc = directives(policy).get('script-src') ?? ''

  assert.doesNotMatch(scriptSrc, /unsafe-inline/)
  assert.doesNotMatch(scriptSrc, /unsafe-eval/)
  assert.match(scriptSrc, /'nonce-abc123'/)
  assert.match(scriptSrc, /'strict-dynamic'/)
})

test('development keeps unsafe-eval for React Refresh but never unsafe-inline', () => {
  const scriptSrc =
    directives(buildContentSecurityPolicy({ nonce: 'abc123', allowUnsafeEval: true })).get('script-src') ?? ''

  assert.match(scriptSrc, /'unsafe-eval'/)
  assert.match(scriptSrc, /'nonce-abc123'/)
  assert.doesNotMatch(scriptSrc, /unsafe-inline/)
})

test('the nonce-less variant used for static assets allows no inline script either', () => {
  assert.equal(directives(buildContentSecurityPolicy()).get('script-src'), "'self'")
})

test('hardened directives from the original header are preserved', () => {
  const parsed = directives(buildContentSecurityPolicy({ nonce: 'abc123' }))

  assert.equal(parsed.get('default-src'), "'self'")
  assert.equal(parsed.get('base-uri'), "'self'")
  assert.equal(parsed.get('frame-ancestors'), "'none'")
  assert.equal(parsed.get('object-src'), "'none'")
  assert.equal(parsed.get('form-action'), "'self'")
  assert.equal(parsed.get('worker-src'), "'self' blob:")
  assert.equal(parsed.get('manifest-src'), "'self'")
})

test('connect-src tracks the configured Supabase origin', () => {
  assert.equal(
    buildConnectSrc('http://127.0.0.1:54321'),
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co http://127.0.0.1:54321 ws://127.0.0.1:54321"
  )
  assert.equal(
    buildConnectSrc('https://project.supabase.co'),
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://project.supabase.co wss://project.supabase.co"
  )
  assert.equal(
    buildConnectSrc('not-a-url'),
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co"
  )
  assert.equal(
    buildConnectSrc(null),
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co"
  )
})

test('nonces are unique and base64', () => {
  const nonces = new Set(Array.from({ length: 50 }, () => createCspNonce()))

  assert.equal(nonces.size, 50)
  for (const nonce of nonces) {
    assert.match(nonce, /^[A-Za-z0-9+/]+={0,2}$/)
    assert.ok(nonce.length >= 20)
  }
})

test('next.config only serves a CSP on paths the middleware matcher excludes', async () => {
  const headers = await configuredHeaders()
  const cspRules = headers.filter((rule) =>
    rule.headers.some((header) => header.key === 'Content-Security-Policy')
  )

  // Every CSP source must be excluded by the middleware matcher, otherwise the response
  // carries two CSP headers and the browser enforces their (script-blocking) intersection.
  const matcherExclusions = /^\/(_next\/static|_next\/image|favicon\.ico|manifest\.json|sw\.js|icons|api\/cron)/
  assert.ok(cspRules.length > 0)
  for (const rule of cspRules) {
    assert.match(rule.source, matcherExclusions, `${rule.source} is also handled by the middleware`)
  }
})

test('next.config static CSP matches the shared builder', async () => {
  const headers = await configuredHeaders()
  const configured = headers
    .flatMap((rule) => rule.headers)
    .filter((header) => header.key === 'Content-Security-Policy')
    .map((header) => header.value)

  const expected = buildContentSecurityPolicy({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  })

  assert.ok(configured.length > 0)
  for (const value of configured) {
    assert.equal(value, expected)
  }
})

test('next.config no longer serves a blanket CSP on every path', async () => {
  const headers = await configuredHeaders()
  const catchAll = headers.find((rule) => rule.source === '/:path*')

  assert.ok(catchAll, 'the catch-all security header rule should still exist')
  assert.deepEqual(
    catchAll.headers.map((header) => header.key).sort(),
    [
      'Permissions-Policy',
      'Referrer-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
    ]
  )
})
