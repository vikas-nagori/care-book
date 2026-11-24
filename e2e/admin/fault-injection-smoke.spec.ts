// Proof that the fault-injection and phone helpers do what they claim (plan F8). Every later
// failure test trusts e2e/support/fault-injection.ts and mobile.ts because this file is green.
//
// Target: Settings → Session Fees bottom sheet → Save Settings, a callServerAction call site, on
// the phone projects (Pixel 5 Chromium and iPhone WebKit). Each fault mode is checked for the
// message, the button coming back, what the database holds, and (stale build) the reload.

import type { Page } from '@playwright/test'
import { SettingsView } from '../pages/settings-view'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { test, expect, type E2EFactory } from '../support/factories'
import {
  ACTION_UNREACHABLE_MESSAGE,
  STALE_DEPLOYMENT_MESSAGE,
  expectButtonRecovers,
  expectedFaultConsoleErrors,
  failNextServerAction,
  holdNextServerAction,
  type ActionFault,
} from '../support/fault-injection'
import {
  E2E_APP_VERSION,
  IOS_TAG,
  backgroundApp,
  expectInViewport,
  expectNoHorizontalOverflow,
  isMobileProject,
  serveAppVersion,
} from '../support/mobile'

// Faults must reach Playwright's router, not the service worker.
test.use({ serviceWorkers: 'block' })

test.beforeEach(({}, testInfo) => {
  test.skip(!isMobileProject(testInfo), 'phone-only proof: runs on admin-mobile and mobile-ios')
})

function guardsFor(page: Page) {
  return attachErrorGuards(page, {
    expectedFailures: expectedFaultConsoleErrors('server-action'),
    // reportClientError's telemetry budget can answer 429 when the matrix runs back to back.
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }],
  })
}

async function openFeesSheet(page: Page) {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true }).filter({ visible: true })).toBeVisible()
  await new SettingsView(page).openSection('Session Fees')
  const sheet = page.getByRole('dialog', { name: 'Session Fees' })
  return {
    sheet,
    clinicFee: sheet.getByLabel('Clinic Visit Fee (₹)', { exact: true }),
    save: sheet.getByRole('button', { name: /^(Save Settings|Saving…)$/ }),
  }
}

async function withFeesRestored(factory: E2EFactory, run: (original: number) => Promise<void>) {
  const original = await factory.getGlobalSettings()
  try {
    await run(Number(original.clinic_fee))
  } finally {
    await factory.restoreGlobalSettings(original)
  }
}

for (const mode of ['abort', 'http-500'] as const satisfies readonly ActionFault[]) {
  test(`a ${mode} server action leaves Save Settings usable and saves nothing`, { tag: IOS_TAG }, async ({ page, factory }) => {
    const guards = guardsFor(page)
    await withFeesRestored(factory, async (original) => {
      const { sheet, clinicFee, save } = await openFeesSheet(page)
      const typed = String(original + 37)
      await clinicFee.fill(typed)

      const fault = await failNextServerAction(page, mode)
      await save.tap()
      await expectButtonRecovers(save, { idleName: 'Save Settings', message: ACTION_UNREACHABLE_MESSAGE, fault })
      await expect(sheet).toBeVisible()
      await expect(clinicFee).toHaveValue(typed)
      expect(Number((await factory.getGlobalSettings()).clinic_fee)).toBe(original)
      expect(fault.hits()).toBe(1)

      // The fault fired once; the same tap now saves.
      await fault.dispose()
      await save.tap()
      await expect(page.getByText('Settings saved', { exact: true }).filter({ visible: true })).toBeVisible()
      await expect.poll(async () => Number((await factory.getGlobalSettings()).clinic_fee)).toBe(Number(typed))
    })
    await guards.assertClean()
  })
}

test('a lost reply still saves once and tells the user to check before retrying', { tag: IOS_TAG }, async ({ page, factory }) => {
  const guards = guardsFor(page)
  await withFeesRestored(factory, async (original) => {
    const { clinicFee, save } = await openFeesSheet(page)
    const typed = String(original + 41)
    await clinicFee.fill(typed)

    const fault = await failNextServerAction(page, 'lost-response')
    await save.tap()
    await expectButtonRecovers(save, { idleName: 'Save Settings', message: ACTION_UNREACHABLE_MESSAGE, fault })
    // The server committed before the reply was lost.
    expect(Number((await factory.getGlobalSettings()).clinic_fee)).toBe(Number(typed))
    await fault.dispose()
  })
  await guards.assertClean()
})

test('a tap on a stale build shows the update message, reloads and saves nothing', { tag: IOS_TAG }, async ({ page, factory }) => {
  const guards = guardsFor(page)
  await withFeesRestored(factory, async (original) => {
    const { clinicFee, save } = await openFeesSheet(page)
    await clinicFee.fill(String(original + 53))

    const fault = await failNextServerAction(page, 'stale-deployment')
    const reloaded = page.waitForEvent('load')
    await save.tap()
    await expectButtonRecovers(save, { idleName: 'Save Settings', message: STALE_DEPLOYMENT_MESSAGE, fault })
    await reloaded
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByRole('heading', { name: 'Settings', exact: true }).filter({ visible: true })).toBeVisible()
    expect(Number((await factory.getGlobalSettings()).clinic_fee)).toBe(original)
    await fault.dispose()

    // After the reload the same save works.
    const fresh = await openFeesSheet(page)
    await fresh.clinicFee.fill(String(original + 54))
    await fresh.save.tap()
    await expect(page.getByText('Settings saved', { exact: true }).filter({ visible: true })).toBeVisible()
    await expect.poll(async () => Number((await factory.getGlobalSettings()).clinic_fee)).toBe(original + 54)
  })
  await guards.assertClean()
})

test('a held save shows its pending state, blocks a second request and finishes once released', { tag: IOS_TAG }, async ({ page, factory }) => {
  const guards = guardsFor(page)
  await withFeesRestored(factory, async (original) => {
    const { clinicFee, save } = await openFeesSheet(page)
    const typed = String(original + 61)
    await clinicFee.fill(typed)

    const hold = await holdNextServerAction(page)
    await save.tap()
    await hold.whenHeld()
    await expect(save).toHaveAccessibleName('Saving…')
    await expect(save).toBeDisabled()
    await clinicFee.press('Enter')
    expect(hold.count()).toBe(1)

    await hold.release()
    await expect(page.getByText('Settings saved', { exact: true }).filter({ visible: true })).toBeVisible()
    await expect(save).toHaveAccessibleName('Save Settings')
    expect(hold.count()).toBe(1)
    await expect.poll(async () => Number((await factory.getGlobalSettings()).clinic_fee)).toBe(Number(typed))
  })
  await guards.assertClean()
})

test('phone helpers: the save button is reachable, nothing scrolls sideways, and a resume onto a newer build reloads once', { tag: IOS_TAG }, async ({ page }) => {
  const guards = guardsFor(page)
  expect(E2E_APP_VERSION, '.env.e2e must give the e2e build a real version').not.toBe('dev')
  await page.clock.install()
  const { save } = await openFeesSheet(page)
  await expectInViewport(save)
  await expectNoHorizontalOverflow(page)
  await expectNoLeakedNulls(page)
  await page.keyboard.press('Escape')

  // Same build: a resume refreshes in place without a reload.
  const same = await serveAppVersion(page, E2E_APP_VERSION)
  let loads = 0
  page.on('load', () => { loads += 1 })
  await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
  await expect.poll(() => same.count()).toBe(1)
  expect(loads).toBe(0)
  await same.dispose()

  // A newer deployment went live while the phone was in a pocket: exactly one reload, still
  // signed in, same screen.
  const newer = await serveAppVersion(page, `${E2E_APP_VERSION}-next`)
  const reloaded = page.waitForEvent('load')
  await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
  await reloaded
  expect(newer.count()).toBe(1)
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('heading', { name: 'Settings', exact: true }).filter({ visible: true })).toBeVisible()
  await newer.dispose()
  await guards.assertClean()
})
