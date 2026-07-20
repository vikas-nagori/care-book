import { expect, type Page } from '@playwright/test'

/**
 * Guards a page against runtime crashes — the class of bug this suite exists to catch
 * (e.g. the Billing → Packages tab throwing "Invalid calendar date" and blanking the page).
 *
 * Attach at the start of a test, drive the page, then call `assertClean()`. It fails on:
 *  - uncaught exceptions (`pageerror`), and
 *  - the App Router error boundary / production error text rendering.
 */
export function attachErrorGuards(page: Page) {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(err.message))

  return {
    async assertClean() {
      expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
      // Next.js App Router renders these when a Server/Client Component throws.
      await expect(page.getByText('Application error', { exact: false })).toHaveCount(0)
      await expect(page.getByText('Internal Server Error', { exact: false })).toHaveCount(0)
      await expect(page.getByText('something went wrong', { exact: false })).toHaveCount(0)
    },
  }
}

/** Navigate and assert the top-level response wasn't a 5xx. Returns the response. */
export async function gotoOk(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' })
  const status = response?.status() ?? 0
  expect(status, `GET ${path} returned ${status}`).toBeLessThan(500)
  return response
}
