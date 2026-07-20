import { expect, test } from '@playwright/test'
import { attachErrorGuards } from '../support/assertions'

// Runs last in the single-worker platform project because signOut() intentionally revokes the
// shared platform account session used by the read-only console smoke specs.
test('signs out through the platform UI and revokes access to the console', async ({ page }) => {
  const guards = attachErrorGuards(page)
  await page.goto('/platform')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:3000/login')
  await page.goto('/platform')
  await expect(page).toHaveURL('http://localhost:3000/login')
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible()
  await guards.assertClean()
})
