import { test } from '@playwright/test'

import { gotoDeniedRoute } from '../support/assertions'

test('platform allowlisted account is redirected from clinic app to platform', async ({ page }) => {
  await gotoDeniedRoute(page, {
    requestPath: '/patients',
    expected: { kind: 'redirect', pathname: '/platform' },
    landmark: { kind: 'heading', name: 'Overview' },
  })
})

test('platform allowlisted account leaves /login for the platform console', async ({ page }) => {
  await gotoDeniedRoute(page, {
    requestPath: '/login',
    expected: { kind: 'redirect', pathname: '/platform' },
    landmark: { kind: 'heading', name: 'Overview' },
  })
})
