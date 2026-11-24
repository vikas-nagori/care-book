// The app is used mostly as an installed phone app (iOS and Android). These cover what that
// means: date taps that don't wait on the server, a screen that catches up when the app is
// brought back, a resume or a tap that finds a newer build, a session that survives the app being
// killed, and the back gesture (plan 5.7: M-1, M-2, M-6, M-14).
//
// Desktop projects skip this whole file (the beforeEach below): it is about the phone app.
// M-1, M-2 and M-6 also run on `mobile-ios` (iPhone, WebKit) through the @ios tag.

import type { Browser, BrowserContext, Locator, Page, Response, TestInfo } from '@playwright/test'

import { SEED } from '../support/ids'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'
import {
  STALE_DEPLOYMENT_MESSAGE,
  expectButtonRecovers,
  expectFailureMessage,
  failNextServerAction,
} from '../support/fault-injection'
import { E2E_APP_VERSION, IOS_TAG, backgroundApp, projectRole, serveAppVersion } from '../support/mobile'
import { FLOWS, openStatusFlow, phoneGuards, phoneSkipReason, type FlowId } from './mobile-flows'

// Faults and the /api/version stub must reach Playwright's router, not the service worker.
test.use({ serviceWorkers: 'block' })

test.beforeEach(({}, testInfo) => {
  const reason = phoneSkipReason(testInfo)
  test.skip(reason !== null, reason ?? '')
})

function fullDateLabel(date: string) {
  return new Intl.DateTimeFormat('en', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    .format(new Date(`${date}T00:00:00.000Z`))
}

/** The appointment detail screen (its phone header title is plain text, not a heading). */

/**
 * The document response re-issued the session cookie, and the device now keeps it for its full
 * lifetime. Chromium reports each Set-Cookie as sent (Max-Age=34560000); WebKit may fold them
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
  // Engines cap how long they keep a cookie (Chromium 400 days, WebKit on Linux one year), so
  // "renewed" means a lifetime of about a year or more from now, not the 7 days a script-written
  // cookie gets on iOS.
  for (const cookie of stored) expect(cookie.expires).toBeGreaterThan(Date.now() / 1000 + 360 * 86_400)
}

const appointmentLandmark = (page: Page) => page.getByText('Appointment', { exact: true }).filter({ visible: true }).first()

const scheduleHeading = (page: Page) => page.getByRole('heading', { name: 'Schedule', exact: true }).filter({ visible: true })

/**
 * Resolves when the app re-fetches the current route's server data (router.refresh). Call it
 * before the resume so the listener is in place. The reply may still be streaming: a test that
 * must see the refreshed screen waits for a sentinel row created while the phone was away.
 */
function waitForRefresh(page: Page, pathname: string) {
  return page.waitForResponse((response) => {
    const request = response.request()
    return request.method() === 'GET' && request.headers()['rsc'] === '1'
      && request.headers()['next-router-prefetch'] === undefined
      && new URL(request.url()).pathname === pathname
  })
}

function countLoads(page: Page) {
  let loads = 0
  page.on('load', () => { loads += 1 })
  return () => loads
}

test('a date tap inside the loaded weeks switches the day without a server round trip', async ({ page, factory }) => {
  const guards = phoneGuards(page)
  const patient = await factory.createPatient()
  const start = clinicDate(150), next = clinicDate(151)
  await factory.createAppointment({ patientId: patient.id, date: next, time: '09:30', status: 'scheduled' })

  await page.goto(`/schedule?date=${start}`)
  await expect(page.getByText(patient.name as string, { exact: true })).toHaveCount(0)
  const rscRequests: string[] = []
  // Only a fetch for a schedule date counts. Navigation link preloads (/patients, the bare
  // /schedule tab link, …) are unrelated background requests.
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.headers()['rsc'] === '1' && url.pathname === '/schedule' && url.searchParams.has('date')) rscRequests.push(request.url())
  })

  await page.getByRole('button', { name: new RegExp(`^${fullDateLabel(next)}, `) }).filter({ visible: true }).click()
  await expect(page).toHaveURL(new RegExp(`date=${next}`))
  await expect(page.getByText(patient.name as string, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  expect(rscRequests).toEqual([])

  // Back returns to the earlier day, still on the device.
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`date=${start}`))
  await expect(page.getByText(patient.name as string, { exact: true })).toHaveCount(0)
  await guards.assertClean()
})

test('bringing the app back after a while shows changes made meanwhile, without signing in again', async ({ page, factory }) => {
  const guards = phoneGuards(page)
  const date = clinicDate(155)
  await page.clock.install()
  await page.goto(`/schedule?date=${date}`)
  await expect(scheduleHeading(page)).toBeVisible()

  // Someone else books while the phone is in a pocket.
  const patient = await factory.createPatient()
  await factory.createAppointment({ patientId: patient.id, date, time: '10:15', status: 'scheduled' })
  await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })

  await expect(page.getByText(patient.name as string, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page).not.toHaveURL(/\/login/)
  await guards.assertClean()
})

// ---------------------------------------------------------------------------------------------
// M-1 Resume into a newer build
// ---------------------------------------------------------------------------------------------

test('M-1 a resume onto a newer build reloads once, signed in on the same screen, and never loops', { tag: IOS_TAG }, async ({ page }) => {
  const guards = phoneGuards(page)
  expect(E2E_APP_VERSION, '.env.e2e must give the e2e build a real version').not.toBe('dev')
  const date = clinicDate(157)
  await page.clock.install()
  await page.goto(`/schedule?date=${date}`)
  await expect(scheduleHeading(page)).toBeVisible()
  const loads = countLoads(page)

  const newer = await serveAppVersion(page, `${E2E_APP_VERSION}-next`)
  const reloaded = page.waitForEvent('load')
  await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
  await reloaded
  await expect(page).toHaveURL(`/schedule?date=${date}`)
  await expect(scheduleHeading(page)).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(loads()).toBe(1)
  expect(newer.count()).toBe(1)
  await newer.dispose()

  // The reloaded app is the new build, so the next resume sees matching versions: the screen is
  // refreshed in place and nothing reloads again.
  const same = await serveAppVersion(page, E2E_APP_VERSION)
  const refreshed = waitForRefresh(page, '/schedule')
  await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
  await refreshed
  expect(same.count()).toBe(1)
  expect(loads()).toBe(1)
  await expect(page).toHaveURL(`/schedule?date=${date}`)
  await same.dispose()
  await guards.assertClean()
})

for (const failure of ['http-500', 'abort'] as const) {
  test(`M-1 a resume whose version check fails (${failure}) does not reload and still refreshes the screen`, { tag: IOS_TAG }, async ({ page, factory }) => {
    // The only console line allowed is the browser's own report of the failed /api/version
    // request; the app itself must log nothing.
    const guards = phoneGuards(page, {
      httpErrors: [{ pathname: '/api/version', status: 500 }],
      failures: [{ url: /\/api\/version(?:\?|$)/, text: /Failed to load resource|ERR_FAILED|Load failed|network connection was lost/i }],
    })
    const date = clinicDate(158)
    await page.clock.install()
    await page.goto(`/schedule?date=${date}`)
    await expect(scheduleHeading(page)).toBeVisible()
    const loads = countLoads(page)

    let checks: () => number
    if (failure === 'http-500') {
      checks = (await serveAppVersion(page, { status: 500 })).count
    } else {
      let aborted = 0
      await page.route((url) => url.pathname === '/api/version', async (route) => {
        aborted += 1
        await route.abort('failed')
      })
      checks = () => aborted
    }

    // Booked by someone else while the phone was away: the refresh must still bring it in.
    const patient = await factory.createPatient()
    await factory.createAppointment({ patientId: patient.id, date, time: '10:20', status: 'scheduled' })
    const refreshed = waitForRefresh(page, '/schedule')
    await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
    await refreshed
    await expect(page.getByText(patient.name as string, { exact: true }).filter({ visible: true }).first()).toBeVisible()
    expect(checks()).toBe(1)
    expect(loads()).toBe(0)
    await expect(page).toHaveURL(`/schedule?date=${date}`)
    await guards.assertClean()
  })
}

// ---------------------------------------------------------------------------------------------
// M-2 A tap on a stale build, before any resume check ran (the 2026-11-24 sequence)
// ---------------------------------------------------------------------------------------------

for (const flowId of ['session-notes', 'reminder', 'create-login'] as const satisfies readonly FlowId[]) {
  const flow = FLOWS[flowId]
  test(`M-2 a tap on a stale build to ${flow.title} shows the update message, reloads once, then succeeds`, { tag: IOS_TAG }, async ({ page, factory }, testInfo) => {
    const reason = phoneSkipReason(testInfo, flow)
    test.skip(reason !== null, reason ?? '')
    const guards = phoneGuards(page)
    const open = await flow.open(page, factory)
    await open.fill()
    const loads = countLoads(page)
    const pathBefore = new URL(page.url()).pathname

    const fault = await failNextServerAction(page, 'stale-deployment')
    const reloaded = page.waitForEvent('load')
    await open.submit.tap()
    await expectButtonRecovers(open.submit, { idleName: open.idleName, message: STALE_DEPLOYMENT_MESSAGE, fault })
    await reloaded
    expect(new URL(page.url()).pathname).toBe(pathBefore)
    expect(await open.rows()).toBe(0)
    expect(fault.hits()).toBe(1)
    await fault.dispose()

    // The reloaded page is the current build: the same action now goes through, once.
    await open.openForm()
    await open.fill()
    await open.submit.tap()
    await open.expectSaved()
    await expect.poll(() => open.rows()).toBe(1)
    expect(loads()).toBe(1)
    await guards.assertClean()
  })
}

test('M-2 a status change on a stale build shows the update message, reloads once, then succeeds', { tag: IOS_TAG }, async ({ page, factory }) => {
  const guards = phoneGuards(page)
  const status = await openStatusFlow(page, factory)
  const loads = countLoads(page)
  const url = page.url()

  const fault = await failNextServerAction(page, 'stale-deployment')
  const reloaded = page.waitForEvent('load')
  await status.choose('Completed')
  await expect.poll(() => fault.hit()).toBe(true)
  await expectFailureMessage(page, STALE_DEPLOYMENT_MESSAGE)
  await reloaded
  expect(page.url()).toBe(url)
  await expect(status.trigger).toHaveText('Scheduled')
  expect(await status.status()).toBe('scheduled')
  await fault.dispose()

  await status.choose('Completed')
  await expect(page.getByText('Status updated', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect.poll(() => status.status()).toBe('completed')
  await expect(status.trigger).toHaveText('Completed')
  expect(loads()).toBe(1)
  await guards.assertClean()
})

// ---------------------------------------------------------------------------------------------
// M-6 Cold start on a deep link after the app was killed
// ---------------------------------------------------------------------------------------------

/**
 * A new browser context, like a phone reopening a killed app: nothing in memory, only what the
 * device stored (the session cookies, plus local storage such as the dismissed welcome tour).
 */
async function coldStart(browser: Browser, testInfo: TestInfo) {
  const use = testInfo.project.use
  return browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    timezoneId: use.timezoneId,
    serviceWorkers: 'block',
    storageState: use.storageState,
  })
}

const COLD_START_LINKS: readonly { path: string; landmark: (page: Page) => Locator; adminOnly?: boolean }[] = [
  { path: '/', landmark: (page) => page.getByRole('heading', { name: 'Today', exact: true }).filter({ visible: true }) },
  { path: `/schedule/${SEED.appointmentShared}`, landmark: (page) => appointmentLandmark(page) },
  { path: `/patients/${SEED.patientAsha}`, landmark: (page) => page.getByText('Asha Rao', { exact: true }).filter({ visible: true }).first() },
  { path: `/schedule?date=${clinicDate(3)}`, landmark: scheduleHeading },
  { path: '/billing?new=1', landmark: (page) => page.getByRole('dialog', { name: 'New Billing Entry' }), adminOnly: true },
]

for (const link of COLD_START_LINKS) {
  test(`M-6 a cold start on ${link.path} opens it directly, signed in, and renews the session cookie`, { tag: IOS_TAG }, async ({ browser }, testInfo) => {
    test.skip(link.adminOnly === true && projectRole(testInfo) !== 'admin', 'admin-only route')
    const context = await coldStart(browser, testInfo)
    try {
      const page = await context.newPage()
      const guards = phoneGuards(page)
      const visited: string[] = []
      page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname) })

      const response = await page.goto(link.path)
      expect(response, `GET ${link.path} returned no document`).not.toBeNull()
      expect(response!.request().redirectedFrom(), `GET ${link.path} was redirected`).toBeNull()
      await expect(link.landmark(page)).toBeVisible()
      expect(visited.filter((path) => path.startsWith('/login'))).toEqual([])
      const requested = new URL(link.path, 'http://localhost')
      expect(new URL(page.url()).pathname).toBe(requested.pathname)

      await expectSessionRenewed(response!, context)
      await guards.assertClean()
    } finally {
      await context.close()
    }
  })
}

// ---------------------------------------------------------------------------------------------
// M-14 Back gesture
// ---------------------------------------------------------------------------------------------

test('M-14 back from an appointment opened on the schedule returns to the same date', async ({ page, factory }) => {
  const guards = phoneGuards(page)
  const patient = await factory.createPatient()
  const date = clinicDate(159)
  const appointment = await factory.createAppointment({ patientId: patient.id, date, time: '09:45' })
  await page.goto('/')
  await page.goto(`/schedule?date=${date}`)
  await page.getByRole('link', { name: new RegExp(patient.name as string) }).filter({ visible: true }).first().tap()
  await expect(page).toHaveURL(`/schedule/${appointment.id}`)
  await expect(appointmentLandmark(page)).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(`/schedule?date=${date}`)
  await expect(scheduleHeading(page)).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(patient.name as string) }).filter({ visible: true }).first()).toBeVisible()
  await guards.assertClean()
})

test('M-14 back from a patient opened from a search returns to the list with the search kept', async ({ page, factory }) => {
  // NEW-M14 (found by this package, no G-id yet): the search box is component state, not part of
  // the URL, so back from the patient lands on /patients with an empty search and the first page.
  test.fail(true, 'NEW-M14: the patient search is lost on back')
  const guards = phoneGuards(page)
  const patient = await factory.createPatient()
  await page.goto('/patients')
  const search = page.getByPlaceholder(/search/i).filter({ visible: true }).first()
  await search.fill(patient.name as string)
  const result = page.getByRole('link', { name: new RegExp(patient.name as string) }).filter({ visible: true }).first()
  await expect(result).toBeVisible()
  await result.tap()
  await expect(page).toHaveURL(`/patients/${patient.id}`)

  await page.goBack()
  await expect(page).toHaveURL('/patients')
  await expect(search).toHaveValue(patient.name as string)
  await expect(page.getByRole('link', { name: new RegExp(patient.name as string) }).filter({ visible: true }).first()).toBeVisible()
  await guards.assertClean()
})

test('M-14 back with a dialog open never leaves a blank screen', async ({ page }) => {
  const guards = phoneGuards(page)
  const date = clinicDate(160)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today', exact: true }).filter({ visible: true })).toBeVisible()
  await page.goto(`/schedule?date=${date}`)
  await page.getByRole('button', { name: /^New appointment$/i }).filter({ visible: true }).tap()
  const dialog = page.getByRole('dialog', { name: 'New Appointment', exact: true })
  await expect(dialog).toBeVisible()

  await page.goBack()
  // Pinned behaviour today: the dialog does not own a history entry, so back leaves the schedule
  // for the previous screen (the dashboard), which renders in full.
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Today', exact: true }).filter({ visible: true })).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await guards.assertClean()
})
