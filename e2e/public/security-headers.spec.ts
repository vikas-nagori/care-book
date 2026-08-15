// The CSP moved from a static next.config header to a per-request nonce built in
// src/middleware.ts, so the header the browser actually receives — and whether the app still
// boots under it — can only be proven against the running production build.

import { expect, test } from '@playwright/test'

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split(';').map((directive) => {
      const [name, ...values] = directive.trim().split(/\s+/)
      return [name, values.join(' ')]
    })
  )
}

test('document responses carry exactly one nonce-based CSP with no unsafe script sources', async ({ request }) => {
  const response = await request.get('/login')
  expect(response.status()).toBe(200)

  // Two CSP headers would be enforced as an intersection and silently break the nonce.
  const raw = response.headersArray().filter((header) => header.name.toLowerCase() === 'content-security-policy')
  expect(raw).toHaveLength(1)

  const scriptSrc = directives(raw[0]!.value).get('script-src') ?? ''
  expect(scriptSrc).not.toContain("'unsafe-inline'")
  expect(scriptSrc).not.toContain("'unsafe-eval'")
  expect(scriptSrc).toContain("'strict-dynamic'")
  expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/]+={0,2}'/)
})

test('every document response gets a different nonce', async ({ request }) => {
  const nonces = await Promise.all(
    [0, 1, 2].map(async () => {
      const response = await request.get('/login')
      const policy = response.headers()['content-security-policy'] ?? ''
      return /'nonce-([^']+)'/.exec(policy)?.[1]
    })
  )

  expect(nonces.every(Boolean)).toBe(true)
  expect(new Set(nonces).size).toBe(3)
})

test('the other hardened security headers survive the CSP move', async ({ request }) => {
  const headers = (await request.get('/login')).headers()

  expect(headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains; preload')
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
})

test('static assets excluded from the middleware still ship a CSP', async ({ request }) => {
  for (const path of ['/manifest.json', '/sw.js']) {
    const policy = (await request.get(path)).headers()['content-security-policy']
    expect(policy, `${path} should ship a CSP`).toBeTruthy()
    expect(directives(policy!).get('script-src')).toBe("'self'")
  }
})

test('the app boots and hydrates with no CSP violations', async ({ page }) => {
  const violations: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(text)) violations.push(text)
  })

  await page.goto('/login')
  // Hydration is the proof: the nonced bootstrap has to run, and 'strict-dynamic' has to carry
  // that trust to every chunk it loads, or this button never becomes interactive.
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeEnabled()
  await page.getByLabel('Email').fill('csp-probe@example.com')
  await expect(page.getByLabel('Email')).toHaveValue('csp-probe@example.com')

  expect(violations).toEqual([])
})
