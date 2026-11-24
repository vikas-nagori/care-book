// External Staff on the installed phone app (plan 5.7: M-15, plus the External Staff parts of
// M-10, M-11 and M-12, which only the external projects can reach). The booking dialog on
// /external must survive a resume, a newer build, a cold start and no signal, exactly like the
// clinic's own forms.
//
// The desktop project skips this whole file (the beforeEach below): it is about the phone app.
// Owned by the mobile package (plan section 6); handed to the External package's directory.

import type { BrowserContext, Page, Response } from '@playwright/test'

import { EXTERNAL, CLINIC_A } from '../support/accounts'
import { attachErrorGuards, gotoSuccessfulRoute } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect, type E2EFactory } from '../support/factories'
import {
  E2E_APP_VERSION,
  PHONE_VIEWPORT,
  SMALL_PHONE_VIEWPORT,
  backgroundApp,
  expectInViewport,
  expectNoHorizontalOverflow,
  isMobileProject,
  serveAppVersion,
} from '../support/mobile'
import { pageRoutesFor } from '../support/route-manifest'
import { adminClient } from '../support/supabase-admin'

test.use({ serviceWorkers: 'block' })

test.beforeEach(({}, testInfo) => {
  test.skip(!isMobileProject(testInfo), 'phone-only: the installed app is the primary client (plan 5.7)')
})


/**
 * The document response re-issued the session cookie, and the device now keeps it for its full
 * 400-day life. Chromium reports each Set-Cookie as sent (Max-Age=34560000); WebKit may fold them
 * into one header and drop attributes, so the stored cookie's expiry is checked on every engine.
 */
async function expectSessionRenewed(response: Response, context: BrowserContext) {
  const issued = (await response.headersArray())
    .filter(({ name }) => name.toLowerCase() === 'set-cookie')
    .flatMap(({ value }) => value.split('\n'))
    .filter((value) => /^sb-[^=]*-auth-token/.test(value))
  expect(issued.length, 'the session cookie was not re-issued').toBeGreaterThan(0)
  for (const cookie of issued) {
    const maxAge = cookie.match(/Max-Age=(\d+)/i)
    if (maxAge) expect(Number(maxAge[1])).toBe(34_560_000)
  }
  const stored = (await context.cookies()).filter((cookie) => /^sb-.*-auth-token/.test(cookie.name))
  expect(stored.length).toBeGreaterThan(0)
  for (const cookie of stored) expect(cookie.expires).toBeGreaterThan(Date.now() / 1000 + 399 * 86_400)
}

const OFFLINE_TEXT = /Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_FAILED|network connection|offline|Load failed/i

function guardsFor(page: Page, offline = false) {
  return attachErrorGuards(page, {
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }],
    expectedFailures: offline ? [{ url: /^http:\/\/localhost:3000\//, text: OFFLINE_TEXT }] : [],
  })
}

const heading = (page: Page) => page.getByRole('heading', { name: 'Schedule', exact: true }).filter({ visible: true })

/** A patient of this test's own, shared with the seeded External Staff account. */
async function sharedPatient(factory: E2EFactory) {
  const patient = await factory.createPatient()
  const external = await factory.findProfileByEmail(EXTERNAL.email)
  await factory.shareWithExternal(patient.id, [external.id])
  return patient
}

async function bookingCount(patientId: string) {
  const { count, error } = await adminClient().from('appointments')
    .select('id', { count: 'exact', head: true }).eq('clinic_id', CLINIC_A.id).eq('patient_id', patientId)
  if (error) throw new Error(`count external bookings: ${error.message}`)
  return count ?? 0
}

/** Opens /external on `date`, opens New appointment and types every field. */
async function openBooking(page: Page, factory: E2EFactory, offset: number) {
  const patient = await sharedPatient(factory)
  const date = clinicDate(offset)
  const time = '11:25'
  await page.goto(`/external?date=${date}`)
  await expect(heading(page)).toBeVisible()
  const openForm = async () => {
    await page.getByRole('button', { name: 'New appointment', exact: true }).filter({ visible: true }).tap()
    await expect(dialog).toBeVisible()
  }
  const dialog = page.getByRole('dialog', { name: 'New appointment', exact: true })
  await openForm()
  const fields = {
    patient: dialog.getByLabel('Patient', { exact: true }),
    type: dialog.getByLabel('Appointment type', { exact: true }),
    date: dialog.getByLabel('Date', { exact: true }),
    time: dialog.getByLabel('Time', { exact: true }),
    duration: dialog.getByLabel('Duration (minutes)', { exact: true }),
  }
  let typeId = ''
  return {
    patient, date, dialog, openForm,
    submit: dialog.getByRole('button', { name: /^(Book appointment|Booking…)$/ }),
    async fill() {
      await fields.patient.selectOption(patient.id)
      await fields.type.selectOption({ index: 1 })
      typeId = await fields.type.inputValue()
      await fields.date.fill(date)
      await fields.time.fill(time)
      await fields.duration.fill('40')
    },
    async expectFilled() {
      await expect(fields.patient).toHaveValue(patient.id)
      await expect(fields.type).toHaveValue(typeId)
      await expect(fields.date).toHaveValue(date)
      await expect(fields.time).toHaveValue(time)
      await expect(fields.duration).toHaveValue('40')
    },
    rows: () => bookingCount(patient.id),
    async expectSaved() {
      await expect(dialog).toBeHidden()
      await expect(page.getByText('Appointment booked', { exact: true }).filter({ visible: true }).first()).toBeVisible()
    },
  }
}

test('M-15 /api/version answers the External Staff app, so its resume check works', async ({ page }) => {
  const response = await page.request.get('/api/version')
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toContain('no-store')
  expect(await response.json()).toEqual({ version: E2E_APP_VERSION })
})

test('M-15 (M-1) a resume onto a newer build reloads /external once, signed in, and never loops', async ({ page }) => {
  const guards = guardsFor(page)
  const date = clinicDate(166)
  await page.clock.install()
  await page.goto(`/external?date=${date}`)
  await expect(heading(page)).toBeVisible()
  let loads = 0
  page.on('load', () => { loads += 1 })

  const newer = await serveAppVersion(page, `${E2E_APP_VERSION}-next`)
  const reloaded = page.waitForEvent('load')
  await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
  await reloaded
  await expect(heading(page)).toBeVisible()
  await expect(page).toHaveURL(`/external?date=${date}`)
  await page.waitForLoadState('networkidle')
  expect(loads).toBe(1)
  await newer.dispose()

  const same = await serveAppVersion(page, E2E_APP_VERSION)
  await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
  await expect.poll(() => same.count()).toBe(1)
  await page.waitForLoadState('networkidle')
  expect(loads).toBe(1)
  await guards.assertClean()
})

test('M-15 (M-1) a resume whose version check fails does not reload /external', async ({ page }) => {
  const guards = attachErrorGuards(page, {
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }, { pathname: '/api/version', status: 500 }],
  })
  await page.clock.install()
  await page.goto(`/external?date=${clinicDate(166)}`)
  await expect(heading(page)).toBeVisible()
  // Let the Vercel analytics scripts settle first: for the external role they are redirected to
  // /external, and with a route installed Playwright no longer reports that redirect, so the
  // guards could not recognise the resulting MIME-type console error as the known local noise.
  await page.waitForLoadState('networkidle')
  let loads = 0
  page.on('load', () => { loads += 1 })
  const failing = await serveAppVersion(page, { status: 500 })
  await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
  await expect.poll(() => failing.count()).toBe(1)
  await page.waitForLoadState('networkidle')
  expect(loads).toBe(0)
  await expect(heading(page)).toBeVisible()
  await guards.assertClean()
})

test('M-15 (M-3) a resume keeps the open booking dialog and every typed value; one tap books once', async ({ page, factory }) => {
  const guards = guardsFor(page)
  await page.clock.install()
  const booking = await openBooking(page, factory, 167)
  await booking.fill()
  const same = await serveAppVersion(page, E2E_APP_VERSION)
  await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
  await expect.poll(() => same.count()).toBe(1)
  await expect(booking.dialog).toBeVisible()
  await booking.expectFilled()

  await booking.submit.tap()
  await booking.expectSaved()
  await expect.poll(() => booking.rows()).toBe(1)
  await guards.assertClean()
})

test('M-15 (M-3) a resume onto a newer build with the booking dialog open reloads once on /external and books nothing', async ({ page, factory }) => {
  const guards = guardsFor(page)
  await page.clock.install()
  const booking = await openBooking(page, factory, 168)
  await booking.fill()
  let loads = 0
  page.on('load', () => { loads += 1 })
  const newer = await serveAppVersion(page, `${E2E_APP_VERSION}-next`)
  const reloaded = page.waitForEvent('load')
  await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
  await reloaded
  await expect(heading(page)).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/external')
  await page.waitForLoadState('networkidle')
  expect(loads).toBe(1)
  await booking.openForm()
  expect(await booking.rows()).toBe(0)
  await newer.dispose()
  await guards.assertClean()
})

test('M-15 (M-6) a cold start on /external opens it directly, signed in, and renews the session cookie', async ({ browser }, testInfo) => {
  const use = testInfo.project.use
  const context = await browser.newContext({
    baseURL: use.baseURL, viewport: use.viewport, userAgent: use.userAgent, deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile, hasTouch: use.hasTouch, timezoneId: use.timezoneId, serviceWorkers: 'block',
    storageState: use.storageState,
  })
  try {
    const page = await context.newPage()
    const guards = guardsFor(page)
    const response = await page.goto('/external')
    expect(response!.request().redirectedFrom()).toBeNull()
    await expect(heading(page)).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/external')
    await expectSessionRenewed(response!, context)
    await guards.assertClean()
  } finally {
    await context.close()
  }
})

test('M-15 (M-7) with no signal, Book appointment says so, keeps the input, and books once back online', async ({ page, context, factory }) => {
  const guards = guardsFor(page, true)
  const booking = await openBooking(page, factory, 169)
  await booking.fill()

  await context.setOffline(true)
  await booking.submit.tap()
  // The dialog passes its own wording to callServerAction for a failure it cannot see.
  const message = booking.dialog.getByRole('alert').filter({ hasText: 'Unable to confirm this booking. Try again to check if it was saved.' })
  await expectInViewport(message)
  await expect(booking.submit).toBeEnabled()
  await expect(booking.submit).toHaveAccessibleName('Book appointment')
  await booking.expectFilled()
  expect(await booking.rows()).toBe(0)

  await context.setOffline(false)
  await booking.submit.tap()
  await booking.expectSaved()
  await expect.poll(() => booking.rows()).toBe(1)
  await guards.assertClean()
})

// External parts of M-10 (reachability), M-11 (no sideways scroll) and M-12 (keyboards).

for (const viewport of [PHONE_VIEWPORT, SMALL_PHONE_VIEWPORT]) {
  test(`M-10 at ${viewport.width}×${viewport.height}, the External Staff booking and reschedule submits are reachable`, async ({ page, factory }) => {
    const guards = guardsFor(page)
    await page.setViewportSize(viewport)
    const booking = await openBooking(page, factory, 170)
    await expectInViewport(booking.submit)
    await expectNoHorizontalOverflow(page)
    await booking.dialog.getByRole('button', { name: 'Cancel', exact: true }).tap()
    await expect(booking.dialog).toBeHidden()

    const date = clinicDate(171)
    await factory.createExternalBooking({ patientId: booking.patient.id, date, time: '12:15' })
    await page.goto(`/external?date=${date}`)
    await page.getByRole('button', { name: new RegExp(booking.patient.name as string) }).filter({ visible: true }).first().tap()
    const reschedule = page.getByRole('dialog', { name: booking.patient.name as string, exact: true })
    await expect(reschedule).toBeVisible()
    await expectInViewport(reschedule.getByRole('button', { name: 'Save changes', exact: true }))
    await expectNoHorizontalOverflow(page)
    await guards.assertClean()
  })
}

for (const declaration of pageRoutesFor('external')) {
  for (const route of declaration.cases) {
    test(`M-11 ${route.requestPath} does not scroll sideways on a phone`, async ({ page }) => {
      await gotoSuccessfulRoute(page, route)
      await expectNoHorizontalOverflow(page)
    })
  }
}

test('M-12 External Staff booking → Duration (minutes) opens the number pad', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const booking = await openBooking(page, factory, 172)
  const duration = booking.dialog.getByLabel('Duration (minutes)', { exact: true })
  await expect(duration).toHaveAttribute('type', 'number')
  await guards.assertClean()
})
