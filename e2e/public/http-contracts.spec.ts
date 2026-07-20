import { expect, test } from '@playwright/test'

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
