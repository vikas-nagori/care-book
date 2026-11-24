import { request as apiRequest, type APIResponse } from '@playwright/test'

import { DEFAULT_INVITE_NEXT_PATH } from '../../src/lib/onboarding/invite-helpers.ts'
import { ADMIN, EXTERNAL } from '../support/accounts'
import { test, expect } from '../support/factories'
import { SEED } from '../support/ids'
import { E2E_APP_VERSION } from '../support/mobile'

const APP_ORIGIN = 'http://localhost:3000'

test('GET /auth/callback without credentials redirects to invite-link-invalid', async ({ request }) => {
  const response = await request.get('/auth/callback', { maxRedirects: 0 })
  expect(response.status()).toBe(307)
  expect(new URL(response.headers().location!).pathname).toBe('/login')
  expect(new URL(response.headers().location!).searchParams.get('error')).toBe('invite-link-invalid')
})

test('GET /auth/callback with an invalid code redirects to invite-link-invalid', async ({ request }) => {
  const response = await request.get('/auth/callback?code=invalid-e2e-code', { maxRedirects: 0 })
  expect(response.status()).toBe(307)
  const location = new URL(response.headers().location!)
  expect(location.pathname).toBe('/login')
  expect(location.searchParams.get('error')).toBe('invite-link-invalid')
})

test('GET /api/cron/auto-complete-appointments rejects missing authorization', async ({ request }) => {
  const response = await request.get('/api/cron/auto-complete-appointments')
  expect(response.status()).toBe(401)
  await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
})

/** The redirect target, resolved against the app; fails unless the reply is a redirect. */
function redirectTarget(response: APIResponse): URL {
  expect(response.status(), `expected a redirect, got ${response.status()}`).toBe(307)
  return new URL(response.headers().location!, APP_ORIGIN)
}

// These are plain HTTP contracts: the viewport changes nothing, so they run once, on the phone
// project (plan 5.6, Pub-M).
test.describe('HTTP contracts (PL-10, PL-11)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'public-mobile', 'HTTP-only contracts run once, on public-mobile')
  })

  // PL-10: every failed or hostile callback lands on this app's /login with the matching error.
  for (const { query, error } of [
    { query: 'token_hash=x', error: 'invite-link-invalid' },
    { query: 'type=recovery&token_hash=bad', error: 'reset-link-invalid' },
    { query: 'code=bad&next=%2Fauth%2Fupdate-password', error: 'reset-link-invalid' },
    { query: 'next=%2F%2Fevil.example', error: 'invite-link-invalid' },
    { query: 'token_hash=bad&type=invite&next=https%3A%2F%2Fevil.example%2Fsteal', error: 'invite-link-invalid' },
  ]) {
    test(`/auth/callback?${query} redirects to /login?error=${error}`, async ({ request }) => {
      const location = redirectTarget(await request.get(`/auth/callback?${query}`, { maxRedirects: 0 }))
      expect(location.origin).toBe(APP_ORIGIN)
      expect(location.pathname).toBe('/login')
      expect(Object.fromEntries(location.searchParams)).toEqual({ error })
    })
  }

  test('a valid recovery link follows a same-origin next path', async ({ request, factory }) => {
    const clinic = await factory.createClinic()
    const user = await factory.createAuthUser({ clinicId: clinic.id })
    const tokenHash = new URL((await factory.createRecoveryAction(user.email)).actionLink).searchParams.get('token_hash')!

    const location = redirectTarget(await request.get(
      `/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=recovery&next=%2Fauth%2Fupdate-password`,
      { maxRedirects: 0 },
    ))
    expect(`${location.origin}${location.pathname}${location.search}`).toBe(`${APP_ORIGIN}/auth/update-password`)
  })

  // A valid token proves the success branch ran (a failed one also lands on this origin, at /login).
  for (const next of ['//evil.example', 'https://evil.example/steal', '/\\evil.example', 'evil.example']) {
    test(`a valid recovery link with next=${next} never leaves this origin`, async ({ request, factory }) => {
      const clinic = await factory.createClinic()
      const user = await factory.createAuthUser({ clinicId: clinic.id })
      const tokenHash = new URL((await factory.createRecoveryAction(user.email)).actionLink).searchParams.get('token_hash')!

      const response = await request.get(
        `/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=recovery&next=${encodeURIComponent(next)}`,
        { maxRedirects: 0 },
      )
      const raw = response.headers().location!
      const location = redirectTarget(response)
      expect(location.origin, `Location: ${raw}`).toBe(APP_ORIGIN)
      expect(location.pathname, `Location: ${raw}`).not.toBe('/login')
      // Protocol-relative and absolute values are replaced by the default page, never followed.
      if (next !== '/\\evil.example') expect(location.pathname).toBe(DEFAULT_INVITE_NEXT_PATH)
    })
  }

  // PL-11: the version endpoint the installed app polls on every resume.
  for (const account of [ADMIN, EXTERNAL]) {
    test(`GET /api/version answers ${account.slug} with the build id and no-store`, async ({ baseURL }) => {
      const context = await apiRequest.newContext({ baseURL, storageState: account.storageState })
      try {
        const response = await context.get('/api/version', { maxRedirects: 0 })
        expect(response.status()).toBe(200)
        expect(response.headers()['content-type']).toContain('application/json')
        expect(response.headers()['cache-control']).toBe('no-store')
        expect(await response.json()).toEqual({ version: E2E_APP_VERSION })
      } finally {
        await context.dispose()
      }
    })
  }

  // MCP is switched off in e2e (decision D3): every MCP and OAuth endpoint must look absent.
  for (const { method, path } of [
    { method: 'GET', path: '/api/mcp' },
    { method: 'POST', path: '/api/mcp' },
    { method: 'GET', path: '/.well-known/oauth-authorization-server' },
    { method: 'GET', path: '/.well-known/oauth-protected-resource' },
    { method: 'POST', path: '/oauth/register' },
    { method: 'POST', path: '/oauth/token' },
    { method: 'POST', path: '/oauth/revoke' },
  ] as const) {
    test(`${method} ${path} answers 404 while MCP is off`, async ({ request }) => {
      const response = method === 'GET'
        ? await request.get(path, { maxRedirects: 0 })
        : await request.post(path, { maxRedirects: 0, data: {} })
      expect(response.status()).toBe(404)
    })
  }

  test('an unauthenticated POST to the payment-due PDF API answers 401 JSON', async ({ request }) => {
    const response = await request.post(`/api/billing/payment-due/${SEED.patientPaymentDue}/pdf`, {
      maxRedirects: 0,
      data: { regularScope: 'all_due' },
    })
    expect(response.status()).toBe(401)
    expect(response.headers()['content-type']).toContain('application/json')
    expect(await response.json()).toEqual({ errorCode: 'UNAUTHORIZED', message: 'You need to sign in again.' })
  })

  for (const path of ['/api/appointments/bookings', '/api/appointments/bookings/status']) {
    test(`an unauthenticated POST to ${path} answers 401 JSON`, async ({ request }) => {
      const response = await request.post(path, { maxRedirects: 0, data: {} })
      expect(response.status()).toBe(401)
      expect(response.headers()['content-type']).toContain('application/json')
      expect(await response.json()).toMatchObject({ success: false, errorCode: 'SCHEDULE_UNAUTHORIZED' })
    })
  }
})
