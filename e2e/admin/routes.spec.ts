import { test } from '@playwright/test'

import { gotoSuccessfulRoute } from '../support/assertions'
import { IOS_TAG } from '../support/mobile'
import { pageRoutesFor } from '../support/route-manifest'

for (const declaration of pageRoutesFor('admin')) {
  for (const route of declaration.cases) {
    test(`renders ${route.requestPath}`, { tag: IOS_TAG }, async ({ page }) => {
      await gotoSuccessfulRoute(page, route)
    })
  }
}
