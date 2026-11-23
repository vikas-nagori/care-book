import { expect, type Page } from '@playwright/test'
import { PASSWORD, type Account } from './accounts'

/** Switch the /login form from its default (mobile number) to email sign-in. */
export async function useEmailSignIn(page: Page) {
  await page.getByRole('button', { name: 'Use email instead', exact: true }).click()
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
}

/**
 * Sign in through the real /login form (mobile number + password — every role, so the default
 * sign-in path is exercised on desktop and mobile alike). This drives the browser Supabase
 * client so @supabase/ssr writes genuine session cookies — the only way past middleware, which
 * validates every request with getUser(). Used by global.setup.ts to persist storageState.
 */
export async function signIn(page: Page, account: Account) {
  await page.goto('/login')
  await page.getByLabel('Mobile number', { exact: true }).fill(account.mobile)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  // Successful sign-in navigates off /login (to / for clinic users, /platform for super-admins).
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 })
  await expect(page).not.toHaveURL(/\/login/)
}
