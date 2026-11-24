// Route smoke for the External Staff workspace (desktop + mobile). Every declared external route
// must render for the seeded EXTERNAL account without a redirect, crash or leaked NULL. The
// seeded sparse fixtures (SEED.patientExternalSparse and its NULL-notes appointment today) are
// on these screens, so the leak check sees NULL-bearing rows.

import { test } from '@playwright/test'

import { gotoSuccessfulRoute } from '../support/assertions'
import { pageRoutesFor } from '../support/route-manifest'

for (const declaration of pageRoutesFor('external')) {
  for (const route of declaration.cases) {
    test(`renders ${route.requestPath}`, async ({ page }) => {
      await gotoSuccessfulRoute(page, route)
    })
  }
}
