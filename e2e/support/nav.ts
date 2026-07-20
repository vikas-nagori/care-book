import { expect, type Locator, type Page } from '@playwright/test'

export type ClinicNavigationRole = 'admin' | 'staff'
export type ClinicNavigationLabel = 'Dashboard' | 'Schedule' | 'Patients' | 'Billing' | 'Settings'

const COMMON_LINKS: readonly ClinicNavigationLabel[] = ['Dashboard', 'Schedule', 'Patients', 'Settings']

function visibleNavigation(page: Page): Locator {
  return page.getByRole('navigation').filter({ visible: true })
}

export async function assertResponsiveClinicNavigation(
  page: Page,
  role: ClinicNavigationRole,
): Promise<void> {
  const width = page.viewportSize()?.width
  expect(width, 'Playwright project must define a viewport').toBeTruthy()

  const nav = visibleNavigation(page)
  await expect(nav).toHaveCount(1)

  const sidebar = page.locator('aside').getByRole('navigation')
  const bottomNav = page.locator('body > nav')
  if (width! >= 768) {
    await expect(sidebar).toBeVisible()
    await expect(bottomNav).toBeHidden()
  } else {
    await expect(sidebar).toBeHidden()
    await expect(bottomNav).toBeVisible()
  }

  for (const label of COMMON_LINKS) {
    await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
  }

  const billing = nav.getByRole('link', { name: 'Billing', exact: true })
  if (role === 'admin') {
    await expect(billing).toBeVisible()
  } else {
    await expect(page.getByRole('link', { name: 'Billing', exact: true })).toHaveCount(0)
  }
}

export async function navigateWithClinicNavigation(
  page: Page,
  label: ClinicNavigationLabel,
  expectedPathname: string,
): Promise<void> {
  const nav = visibleNavigation(page)
  await expect(nav).toHaveCount(1)
  await nav.getByRole('link', { name: label, exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPathname)
}
