// Admin-only Billing coverage. The headline test is the direct regression guard for the bug
// that motivated this whole suite: the Packages tab rendered each package's created_at (a full
// timestamptz) with formatDateOnly, which threw "Invalid calendar date" and blanked the page.

import { test, expect } from '@playwright/test'
import { attachErrorGuards } from '../support/assertions'

test('Billing → Packages tab renders a package with a timestamp created_at (regression)', async ({ page }) => {
  const guards = attachErrorGuards(page)
  const response = await page.goto('/billing?tab=packages', { waitUntil: 'domcontentloaded' })
  expect(response?.ok(), `GET /billing?tab=packages returned ${response?.status()}`).toBe(true)
  expect(response?.request().redirectedFrom()).toBeNull()
  await expect(page).toHaveURL(/\/billing\?tab=packages$/)
  // Seeded package + patient must be visible; before the fix this tab threw on render.
  await expect(page.getByText('10-Session Physiotherapy Package')).toBeVisible()
  await expect(page.getByText('Asha Rao')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await guards.assertClean()
})
