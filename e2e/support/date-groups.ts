import type { Page } from '@playwright/test'

/**
 * Billing metric drill-downs collapse their records under one accordion per date, so a test that
 * asserts on an individual record has to open the dates first. Opening all of them keeps the test
 * from having to know which day its fixture landed on — and on a page with no accordions (the
 * payment-due detail, say) this is a no-op.
 */
export async function expandAllDateGroups(page: Page): Promise<void> {
  const headers = page.getByTestId('date-group-header')
  const count = await headers.count()
  for (let index = 0; index < count; index++) {
    const header = headers.nth(index)
    if ((await header.getAttribute('aria-expanded')) === 'false') await header.click()
  }
}
