import { test } from '@playwright/test'

import { gotoDeniedRoute } from '../support/assertions'
import { SEED } from '../support/ids'

const ADMIN_ONLY_ROUTES = [
  '/billing',
  '/billing/metrics/billed-this-month',
  `/billing/payment-due/${SEED.patientPaymentDue}`,
] as const

for (const path of ADMIN_ONLY_ROUTES) {
  test(`denies staff access to ${path}`, async ({ page }) => {
    await gotoDeniedRoute(page, {
      requestPath: path,
      expected: { kind: 'redirect', pathname: '/' },
      landmark: { kind: 'heading', name: 'Today' },
    })
  })
}
