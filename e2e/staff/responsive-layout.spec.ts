import { test, expect, type Page, type TestInfo } from '@playwright/test'

import { attachErrorGuards } from '../support/assertions'

function isMobileProject(testInfo: TestInfo) {
  return testInfo.project.name.endsWith('-mobile')
}

async function assertMdBreakpoint(page: Page, testInfo: TestInfo) {
  const mobile = isMobileProject(testInfo)
  expect(page.viewportSize()!.width < 768).toBe(mobile)
  expect(await page.evaluate(() => window.matchMedia('(min-width: 768px)').matches)).toBe(!mobile)
}

test('staff dashboard keeps its mobile quick actions account-safe and single-column', async ({ page }, testInfo) => {
  const guards = attachErrorGuards(page)

  await page.goto('/')
  await assertMdBreakpoint(page, testInfo)

  const mobileAppointment = page.getByRole('button', {
    name: 'New appt',
    exact: true,
    includeHidden: true,
  })
  const desktopAppointment = page.getByRole('button', {
    name: 'New appointment',
    exact: true,
    includeHidden: true,
  })
  await expect(page.getByRole('link', { name: 'New billing', exact: true })).toHaveCount(0)

  if (!isMobileProject(testInfo)) {
    await expect(desktopAppointment).toBeVisible()
    await expect(mobileAppointment).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Up next', exact: true }).filter({ visible: true })).toHaveCount(1)
    await guards.assertClean()
    return
  }

  await expect(desktopAppointment).toBeHidden()
  await expect(mobileAppointment).toBeVisible()
  const columns = await mobileAppointment.evaluate((element) => (
    getComputedStyle(element.parentElement!).gridTemplateColumns.split(' ').length
  ))
  expect(columns).toBe(1)

  const upNext = page.getByRole('heading', { name: 'Up next', exact: true }).filter({ visible: true })
  const firstStat = page.getByText('This week', { exact: true })
  await expect(upNext).toHaveCount(1)
  expect(await upNext.evaluate((element, stat) => (
    Boolean(element.compareDocumentPosition(stat as Node) & Node.DOCUMENT_POSITION_FOLLOWING)
  ), await firstStat.elementHandle())).toBe(true)

  await guards.assertClean()
})
