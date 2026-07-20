import { test } from '@playwright/test'

import { gotoSuccessfulRoute } from '../support/assertions'
import { pageRoutesFor } from '../support/route-manifest'

for (const declaration of pageRoutesFor('platform')) {
  for (const route of declaration.cases) {
    test(`renders ${route.requestPath}`, async ({ page }) => {
      await gotoSuccessfulRoute(page, route)
    })
  }
}
