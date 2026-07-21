import { expect, test } from '@playwright/test'
import { PLATFORM } from '../support/accounts'
import { attachErrorGuards } from '../support/assertions'
import { signIn } from '../support/login'

test('signs out through the platform UI and revokes access to the console', async ({ page }) => {
  // Authenticate inside each attempt: signOut() revokes this refresh token, so a Playwright retry
  // cannot safely reuse a persisted session from global setup.
  await signIn(page, PLATFORM)
  const guards = attachErrorGuards(page)
  await page.goto('/platform')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:3000/login')
  await page.goto('/platform')
  await expect(page).toHaveURL('http://localhost:3000/login')
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible()
  await guards.assertClean()
})
