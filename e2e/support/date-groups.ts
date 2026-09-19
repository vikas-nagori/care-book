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
 * Open every date on the page, so a test never has to know which day its fixture landed on.
 *
 * Waits for the list to render first. Locator.count() does not auto-retry, and these routes stream
 * in behind a loading.tsx — so counting straight after a navigation can see zero headers, silently
 * expand nothing, and leave the caller asserting against a still-collapsed list.
 *
 * Only call this on a drill-down that is expected to have at least one record.
 */
export async function expandAllDateGroups(page: Page): Promise<void> {
  await expect(page.getByTestId('date-group-list')).toBeVisible()
  const headers = page.getByTestId('date-group-header')
  await expect(headers.first()).toBeVisible()

  const count = await headers.count()
  for (let index = 0; index < count; index++) {
    await expandDateGroup(headers.nth(index))
  }
}
