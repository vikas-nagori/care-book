import { test } from '@playwright/test'

import { gotoDeniedRoute, gotoSuccessfulRoute } from '../support/assertions'

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

// Regression: the superadmin bounce used to swallow the MCP consent screen, stranding the
// OAuth flow on /platform so the client never received its authorization code. MCP is off in
// the e2e stack, so the page renders its disabled notice — the point of the assertion is that
// the request stays on /oauth/authorize instead of being redirected away.
test('platform allowlisted account reaches the MCP consent screen instead of the console', async ({ page }) => {
  await gotoSuccessfulRoute(page, {
    requestPath: '/oauth/authorize',
    expected: { kind: 'render', pathname: '/oauth/authorize' },
    landmark: { kind: 'heading', name: 'Unable to connect Care-Book' },
  })
})
