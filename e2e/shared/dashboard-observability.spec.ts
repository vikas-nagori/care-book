import { expect, test } from '@playwright/test'

test('dashboard renders role-appropriate metrics and records a local performance sample', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const samples: number[] = []
    Object.assign(window, { carebookLcpSamples: samples })
    new PerformanceObserver(list => { for (const entry of list.getEntries()) samples.push(entry.startTime) })
      .observe({ type: 'largest-contentful-paint', buffered: true })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  const outstanding = page.getByRole('link', { name: /Outstanding/ })
  if (testInfo.project.name.startsWith('staff')) await expect(outstanding).toHaveCount(0)
  else await expect(outstanding).toBeVisible()
  const sample = await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    const samples = (window as unknown as { carebookLcpSamples: number[] }).carebookLcpSamples
    return { ttfbMs: navigation.responseStart, responseEndMs: navigation.responseEnd, transferredBytes: navigation.transferSize, lcpMs: samples.at(-1) ?? null }
  })
  await testInfo.attach('dashboard-performance.json', { body: JSON.stringify(sample), contentType: 'application/json' })
})
