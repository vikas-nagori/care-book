import { expect, test } from '@playwright/test'
import { PLATFORM_SIGNOUT } from '../support/accounts'
import { attachErrorGuards } from '../support/assertions'
import { signIn } from '../support/login'

test('signs out through the platform UI and revokes access to the console', async ({ page }) => {
  // Default signOut() revokes every session for this user. Authenticate a dedicated identity inside
  // each attempt so neither retries nor the primary platform console account share its token state.
  await signIn(page, PLATFORM_SIGNOUT)
  const guards = attachErrorGuards(page)
  await page.goto('/platform')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:3000/login')
  await page.goto('/platform')
  await expect(page).toHaveURL('http://localhost:3000/login?next=%2Fplatform')
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible()
  await guards.assertClean()
})
