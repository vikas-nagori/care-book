// Public (unauthenticated) coverage — no stored session. Validates the login page renders and
// that middleware guards protected routes.

import { test, expect } from '@playwright/test'
import { attachErrorGuards, gotoOk } from '../support/assertions'

test('login page loads for unauthenticated visitors', async ({ page }) => {
  const guards = attachErrorGuards(page)
  await gotoOk(page, '/login')
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()
  await guards.assertClean()
})

test('a protected route redirects to /login when unauthenticated', async ({ page }) => {
  await page.goto('/patients')
  await expect(page).toHaveURL(/\/login/)
})
