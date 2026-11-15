// The app's fonts are self-hosted (src/app/fonts) so the build never fetches from Google. This
// proves the real page loads them from its own origin and that text renders in Inter, with the
// mono family available for figures — not silently falling back to Arial.

import { expect, test } from '@playwright/test'

test('Inter and JetBrains Mono load from the app itself, never from Google', async ({ page }) => {
  const fontRequests: string[] = []
  page.on('request', (request) => {
    if (request.resourceType() === 'font' || /fonts\.(googleapis|gstatic)\.com/.test(request.url())) {
      fontRequests.push(request.url())
    }
  })

  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible()

  // Force both families (and the rupee sign, which lives in the latin-ext subset) to load.
  const loaded = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 16px Inter', 'Care-Book ₹'),
      document.fonts.load('500 16px "JetBrains Mono"', '₹ 1,234'),
    ])
    await document.fonts.ready
    return [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replace(/"/g, ''))
  })
  expect(loaded).toContain('Inter')
  expect(loaded).toContain('JetBrains Mono')

  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
  expect(bodyFont).toMatch(/^"?Inter"?/)

  expect(fontRequests.length).toBeGreaterThan(0)
  const origin = new URL(page.url()).origin
  for (const url of fontRequests) {
    expect(url.startsWith(`${origin}/_next/static/media/`), url).toBe(true)
  }
})
