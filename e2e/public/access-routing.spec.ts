import { test } from '@playwright/test'

import { gotoDeniedRoute } from '../support/assertions'
import { PAGE_ROUTE_MANIFEST } from '../support/route-manifest'

const PROTECTED_ROUTES = PAGE_ROUTE_MANIFEST
  .filter((declaration) => declaration.access !== 'public')
  .flatMap((declaration) => declaration.cases)

for (const route of PROTECTED_ROUTES) {
  test(`redirects unauthenticated GET ${route.requestPath} to /login`, async ({ page }) => {
    await gotoDeniedRoute(page, {
      requestPath: route.requestPath,
      expected: {
        kind: 'redirect',
        pathname: '/login',
        query: { next: route.requestPath },
      },
      landmark: { kind: 'button', name: 'Sign In' },
    })
  })
}
