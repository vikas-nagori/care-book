import { test, expect } from '@playwright/test'

import { attachErrorGuards } from '../support/assertions'

const ADMIN_SECTION_LABELS = [
  'Session Fees',
  'Appointment Types',
  'Package Templates',
  'Invite User',
  'External Staff',
  'Invites',
  'Active Users',
] as const

test('limits staff settings to account details and logout', async ({ page }, testInfo) => {
  const guards = attachErrorGuards(page)

  await page.goto('/settings')

  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.getByText('Your Account', { exact: true }).filter({ visible: true })).toBeVisible()
  for (const label of ADMIN_SECTION_LABELS) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0)
  }

  if (testInfo.project.name.endsWith('-mobile')) {
    const accountTrigger = page.getByRole('button', { name: /Your Account.*Profile & logout/i })
    await expect(accountTrigger).toHaveAttribute('aria-expanded', 'false')
    const accountTriggerElement = await accountTrigger.elementHandle()
    expect(accountTriggerElement).not.toBeNull()
    await accountTrigger.click()
    await expect.poll(() => accountTriggerElement!.getAttribute('aria-expanded')).toBe('true')
    const accountSheet = page.getByRole('dialog', { name: 'Your Account', exact: true })
    await expect(accountSheet).toBeVisible()
    await accountSheet.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(accountSheet).toBeHidden()
    await expect(accountTrigger).toHaveAttribute('aria-expanded', 'false')
    await expect(accountTrigger).toBeFocused()
    await accountTrigger.click()
  }
  await expect(page.getByText('Name', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText('Email', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText('Mobile', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText('Role', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeVisible()
  await guards.assertClean()
})
