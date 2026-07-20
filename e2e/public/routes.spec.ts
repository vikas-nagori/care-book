import { test } from '@playwright/test'

import { gotoExpectedRedirect, gotoSuccessfulRoute } from '../support/assertions'
import { pageRoutesFor } from '../support/route-manifest'

for (const declaration of pageRoutesFor('public')) {
  for (const route of declaration.cases) {
    test(`${route.expected.kind === 'render' ? 'renders' : 'redirects invalid session for'} ${route.requestPath}`, async ({ page }) => {
      if (route.expected.kind === 'render') {
        await gotoSuccessfulRoute(page, route)
      } else {
        await gotoExpectedRedirect(page, route)
      }
    })
  }
}
