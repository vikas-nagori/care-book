import { test, expect } from '@playwright/test'

import { gotoDeniedRoute } from '../support/assertions'
import { SEED } from '../support/ids'

const ADMIN_ONLY_ROUTES = [
  '/billing',
  '/billing?new=1',
  '/billing/metrics/billed-this-month',
  '/billing/metrics/billed-last-month',
  '/billing/metrics/received-this-month',
  `/billing/payment-due/${SEED.patientPaymentDue}`,
  `/billing/packages/${SEED.packageAsha}`,
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

// B-16. The PDF API checks the role itself: a staff session gets a 403 JSON refusal, never a PDF.
test('a staff POST to the payment PDF API is refused with 403 JSON, not a PDF', async ({ page }) => {
  const response = await page.request.post(`/api/billing/payment-due/${SEED.patientPaymentDue}/pdf`, {
    data: { regularScope: 'all_due' },
  })
  expect(response.status()).toBe(403)
  expect(response.headers()['content-type']).toContain('application/json')
  expect(response.headers()['content-type']).not.toContain('application/pdf')
  expect(await response.json()).toMatchObject({ errorCode: 'FORBIDDEN' })
})
