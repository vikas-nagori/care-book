import { expect, type Page } from '@playwright/test'
import { PASSWORD, type Account } from './accounts'

/**
 * Sign in through the real /login form (email + password). This drives the browser Supabase
 * client so @supabase/ssr writes genuine session cookies — the only way past middleware, which
 * validates every request with getUser(). Used by global.setup.ts to persist storageState.
 */
export async function signIn(page: Page, account: Account) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign In' }).click()
  // Successful sign-in navigates off /login (to / for clinic users, /platform for super-admins).
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 })
  await expect(page).not.toHaveURL(/\/login/)
}
