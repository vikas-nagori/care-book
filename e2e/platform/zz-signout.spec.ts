import { expect, test } from '@playwright/test'
import { PLATFORM_SIGNOUT } from '../support/accounts'
import { attachErrorGuards } from '../support/assertions'
import {
  ACTION_UNREACHABLE_MESSAGE,
  expectFailureMessage,
  expectedFaultConsoleErrors,
  failNextServerAction,
} from '../support/fault-injection'
import { signIn } from '../support/login'

// Faults must reach Playwright's router, not the service worker.
test.use({ serviceWorkers: 'block' })

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

test('a dropped sign-out request keeps the console usable and the retry signs out (G-15)', async ({ page }) => {
  // G-15: Sign out goes through callServerAction (src/app/platform/sign-out-button.tsx), so a
  // dropped request shows the usual message and leaves the console signed in and usable.
  await signIn(page, PLATFORM_SIGNOUT)
  const guards = attachErrorGuards(page, { expectedFailures: expectedFaultConsoleErrors('server-action') })
  await page.goto('/platform')
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true })

  const fault = await failNextServerAction(page, 'abort')
  await signOut.click()
  await expect.poll(() => fault.hit()).toBe(true)
  await expectFailureMessage(page, ACTION_UNREACHABLE_MESSAGE)
  await expect(page).toHaveURL('http://localhost:3000/platform')
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
  await expect(signOut).toBeEnabled()

  await fault.dispose()
  await signOut.click()
  await expect(page).toHaveURL('http://localhost:3000/login')
  await guards.assertClean()
})
