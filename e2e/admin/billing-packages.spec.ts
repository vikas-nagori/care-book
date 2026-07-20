// Admin-only Billing coverage. The headline test is the direct regression guard for the bug
// that motivated this whole suite: the Packages tab rendered each package's created_at (a full
// timestamptz) with formatDateOnly, which threw "Invalid calendar date" and blanked the page.

import { test, expect } from '@playwright/test'
import { attachErrorGuards, gotoOk } from '../support/assertions'

test('Billing overview loads for admin', async ({ page }) => {
  const guards = attachErrorGuards(page)
  await gotoOk(page, '/billing')
  await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible()
  await guards.assertClean()
})

test('Billing → Packages tab renders a package with a timestamp created_at (regression)', async ({ page }) => {
  const guards = attachErrorGuards(page)
  await gotoOk(page, '/billing?tab=packages')
  // Seeded package + patient must be visible; before the fix this tab threw on render.
  await expect(page.getByText('10-Session Physiotherapy Package')).toBeVisible()
  await expect(page.getByText('Asha Rao')).toBeVisible()
  await guards.assertClean()
})
