// Runs once before every spec (the `setup` project other projects depend on):
//   1. seed clinics, accounts, patients, and a package into the local Supabase stack, then
//   2. sign each account in through the real /login form and persist its storageState,
// so specs start already authenticated without repeating the login.
//
// Serial so seeding completes before any authentication attempt.

import { test as setup } from '@playwright/test'
import { seedDatabase } from '../support/seed'
import { AUTHENTICATED_ACCOUNTS } from '../support/accounts'
import { signIn } from '../support/login'

setup.describe.configure({ mode: 'serial' })

setup('seed database', async () => {
  await seedDatabase()
})

for (const account of AUTHENTICATED_ACCOUNTS) {
  setup(`authenticate ${account.slug}`, async ({ page }) => {
    await signIn(page, account)
    await page.context().storageState({ path: account.storageState })
  })
}
