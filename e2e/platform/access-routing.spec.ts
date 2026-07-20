import { test } from '@playwright/test'

import { gotoDeniedRoute } from '../support/assertions'

test('platform allowlisted account is redirected from clinic app to platform', async ({ page }) => {
  await gotoDeniedRoute(page, {
    requestPath: '/patients',
    expected: { kind: 'redirect', pathname: '/platform' },
    landmark: { kind: 'heading', name: 'Overview' },
  })
})
