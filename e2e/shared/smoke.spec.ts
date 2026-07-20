// Smoke coverage for routes available to BOTH admin and staff. Runs under admin-desktop,
// admin-mobile, staff-desktop, and staff-mobile — so a route that renders for admins but
// crashes for staff (or on mobile) is caught. This is the coverage that would have caught
// the Billing → Packages crash class at the route level.

import { test } from '@playwright/test'
import { attachErrorGuards, gotoOk } from '../support/assertions'
import { SEED } from '../support/ids'

const ROUTES = [
  '/',
  '/patients',
  '/patients/new',
  `/patients/${SEED.patientAsha}`,
  `/patients/${SEED.patientAsha}/edit`,
  '/schedule',
  '/schedule/new',
  '/settings',
]

for (const route of ROUTES) {
  test(`loads ${route} without crashing`, async ({ page }) => {
    const guards = attachErrorGuards(page)
    await gotoOk(page, route)
    await guards.assertClean()
  })
}
