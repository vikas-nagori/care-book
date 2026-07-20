import { test } from '@playwright/test'

import { gotoDeniedRoute } from '../support/assertions'

test('authenticated clinic users leave /login for the clinic dashboard', async ({ page }) => {
  await gotoDeniedRoute(page, {
    requestPath: '/login',
    expected: { kind: 'redirect', pathname: '/' },
    landmark: { kind: 'heading', name: 'Today' },
  })
})

test('non-allowlisted clinic users cannot enter the platform console', async ({ page }) => {
  await gotoDeniedRoute(page, {
    requestPath: '/platform',
    expected: { kind: 'redirect', pathname: '/' },
    landmark: { kind: 'heading', name: 'Today' },
  })
})
