import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Billing metric drill-downs collapse their records under one accordion per date, so a test that
 * asserts on an individual record has to open the dates first.
 *
 * Clicking is retried until the header actually reports itself open: the headers are server-rendered
 * before React hydrates, so an early click can land on a button that has no handler attached yet and
 * be silently swallowed.
 */
export async function expandDateGroup(header: Locator): Promise<void> {
  await expect(async () => {
    if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'true')
  }).toPass({ timeout: 15_000 })
}

/** The inverse of {@link expandDateGroup}, retried for the same reason. */
export async function collapseDateGroup(header: Locator): Promise<void> {
  await expect(async () => {
    if ((await header.getAttribute('aria-expanded')) !== 'false') await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'false')
  }).toPass({ timeout: 15_000 })
}

/**
 * Open every date on the page, so a test never has to know which day its fixture landed on. A no-op
 * on a page with no accordions (the payment-due detail, say).
 */
export async function expandAllDateGroups(page: Page): Promise<void> {
  const headers = page.getByTestId('date-group-header')
  const count = await headers.count()
  for (let index = 0; index < count; index++) {
    await expandDateGroup(headers.nth(index))
  }
}
