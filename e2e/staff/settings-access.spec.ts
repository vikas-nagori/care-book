import type { Browser, Page, Request } from '@playwright/test'

import { SettingsView, STAFF_SETTINGS_SECTIONS } from '../pages/settings-view'
import { ADMIN, CLINIC_A } from '../support/accounts'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { test, expect } from '../support/factories'
import { isServerActionRequest } from '../support/fault-injection'
import { useEmailSignIn } from '../support/login'
import { isMobileProject } from '../support/mobile'

const ADMIN_SECTION_LABELS = [
  'Session Fees',
  'Appointment Types',
  'Package Templates',
  'Invite User',
  'Temporary Staff',
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

test('staff settings sections render without leaking a null', async ({ page }) => {
  const guards = attachErrorGuards(page)
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await new SettingsView(page).visitEverySection(async (scope) => {
    await expectNoLeakedNulls(page, { scope })
  }, STAFF_SETTINGS_SECTIONS)
  await guards.assertClean()
})

// ---------------------------------------------------------------------------------------------
// SA-16: the admin checks live in the server actions, not only in the hidden UI. Capture a real
// admin action call (its id and encoded arguments) in an admin context, abort it there so it
// never runs, and replay the identical POST with this project's staff cookies.
// ---------------------------------------------------------------------------------------------

type CapturedAction = { url: string; headers: Record<string, string>; body: string }

async function captureAdminAction(browser: Browser, perform: (page: Page) => Promise<void>): Promise<CapturedAction> {
  // A context of its own with the admin session; this spec's own context is signed in as staff.
  const context = await browser.newContext({ storageState: ADMIN.storageState, serviceWorkers: 'block' })
  const page = await context.newPage()
  let captured: CapturedAction | null = null
  await page.route(() => true, async (route) => {
    const request: Request = route.request()
    if (captured || !isServerActionRequest(request)) {
      await route.fallback()
      return
    }
    const headers = request.headers()
    captured = {
      url: request.url(),
      headers: Object.fromEntries(
        ['next-action', 'next-router-state-tree', 'content-type', 'accept']
          .filter((name) => headers[name] !== undefined)
          .map((name) => [name, headers[name]]),
      ),
      body: request.postData() ?? '',
    }
    // The admin's own call never reaches the server.
    await route.abort('failed')
  })
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true }).filter({ visible: true })).toBeVisible()
  await perform(page)
  await expect.poll(() => captured !== null, { message: 'the admin action was never sent' }).toBe(true)
  await context.close()
  return captured!
}

test('SA-16: a captured admin "add appointment type" call replayed with staff cookies is refused and saves nothing', async ({ page, browser, factory }) => {
  const name = factory.uniqueName('replayed-type')
  factory.watchUiAppointmentType(name)
  const action = await captureAdminAction(browser, async (admin) => {
    const settings = new SettingsView(admin)
    await settings.openSection('Appointment Types')
    const scope = settings.sectionScope('Appointment Types')
    await scope.getByRole('button', { name: 'Add appointment type', exact: true }).click()
    await scope.getByLabel('Appointment type name', { exact: true }).fill(name)
    await scope.getByLabel('Session rate (₹)', { exact: true }).fill('555')
    await scope.getByRole('button', { name: 'Save', exact: true }).click()
  })
  expect(action.body).toContain(name)

  await page.goto('/settings')
  const response = await page.request.post(action.url, {
    headers: { ...action.headers, origin: 'http://localhost:3000' },
    data: action.body,
  })
  expect(response.status()).toBe(200)
  const text = await response.text()
  expect(text).toContain('"success":false')
  expect(text).toContain('Only admins can manage appointment types.')
  expect(await factory.findAppointmentTypeByName(name)).toBeNull()
})

test('SA-16: a captured admin "save session fees" call replayed with staff cookies is refused and changes nothing', async ({ page, browser, factory }) => {
  const original = await factory.getGlobalSettings()
  const typed = Number(original.clinic_fee) + 71
  try {
    const action = await captureAdminAction(browser, async (admin) => {
      const settings = new SettingsView(admin)
      await settings.openSection('Session Fees')
      const scope = settings.sectionScope('Session Fees')
      await scope.getByLabel('Clinic Visit Fee (₹)', { exact: true }).fill(String(typed))
      await scope.getByRole('button', { name: 'Save Settings', exact: true }).click()
    })
    expect(action.body).toContain(String(typed))

    await page.goto('/settings')
    const response = await page.request.post(action.url, {
      headers: { ...action.headers, origin: 'http://localhost:3000' },
      data: action.body,
    })
    expect(response.status()).toBe(200)
    const text = await response.text()
    expect(text).toContain('"success":false')
    expect(text).toContain('Only admins can update session fees.')
    expect(await factory.getGlobalSettings()).toMatchObject({
      clinic_fee: original.clinic_fee,
      home_visit_fee: original.home_visit_fee,
    })
  } finally {
    await factory.restoreGlobalSettings(original)
  }
})

// ---------------------------------------------------------------------------------------------
// SA-17 (decision D4d, change C-4): /auth/update-password is only for a session that arrived from
// a reset link. A signed-in user who opens it directly is sent to Settings, where changing a
// password needs the current one. Today any signed-in session gets the form (G-16). A throwaway
// staff user is used so nothing here can touch the seeded shared sessions.
// ---------------------------------------------------------------------------------------------

test.fail('C-4 SA-17: signed-in staff opening /auth/update-password directly are sent to Settings', async ({ browser, factory }, testInfo) => {
  testInfo.skip(!isMobileProject(testInfo), 'phone-only (S-M)')
  const user = await factory.createAuthUser({ clinicId: CLINIC_A.id, role: 'staff' })
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await page.goto('http://localhost:3000/login')
  await page.getByLabel('Mobile number', { exact: true }).fill(user.mobileNumber)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await page.waitForURL('http://localhost:3000/')

  await page.goto('/auth/update-password')
  expect(new URL(page.url()).pathname).toBe('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.getByLabel('Current password', { exact: true }).or(page.getByRole('button', { name: /^Your Account/ })).first()).toBeVisible()
  await context.close()
})

test('SA-17: a reset-link session still reaches /auth/update-password and sets a new password', async ({ browser, factory }, testInfo) => {
  testInfo.skip(!isMobileProject(testInfo), 'phone-only (S-M)')
  const user = await factory.createAuthUser({ clinicId: CLINIC_A.id, role: 'staff' })
  const recovery = await factory.createRecoveryAction(user.email)
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  const guards = attachErrorGuards(page)
  await page.addInitScript(() => window.localStorage.setItem('care-book:guided-tour-seen', 'true'))

  await page.goto(recovery.actionLink)
  await expect(page).toHaveURL('http://localhost:3000/auth/update-password')
  await expect(page.getByText('Reset your password', { exact: true })).toBeVisible()
  const newPassword = `E2e-${factory.token}-R3set`
  await page.getByLabel('New password', { exact: true }).fill(newPassword)
  await page.getByLabel('Confirm password', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: 'Update Password', exact: true }).tap()
  await expect(page).toHaveURL('http://localhost:3000/')

  await context.clearCookies()
  await page.goto('/login')
  await useEmailSignIn(page)
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password').fill(newPassword)
  await page.getByRole('button', { name: 'Sign In', exact: true }).tap()
  await expect(page).toHaveURL('http://localhost:3000/')
  await guards.assertClean()
  await context.close()
})
