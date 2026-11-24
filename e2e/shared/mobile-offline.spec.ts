// No signal on the phone (plan 5.7: M-7, M-8). A clinician taps Save in a basement or a lift:
// the app must say so in plain words, keep what was typed, and save exactly once when the signal
// is back. A connection that drops after the server saved must not lead to a second record.
//
// Desktop projects skip this whole file (the beforeEach below): it is about the phone app.

import type { Page } from '@playwright/test'

import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'
import {
  ACTION_UNREACHABLE_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  expectedFaultConsoleErrors,
  failNextServerAction,
} from '../support/fault-injection'
import { E2E_APP_VERSION, backgroundApp, expectInViewport, serveAppVersion } from '../support/mobile'
import { BOOKINGS_PATH, FLOWS, openStatusFlow, phoneGuards, phoneSkipReason, type FlowId } from './mobile-flows'

test.use({ serviceWorkers: 'block' })

test.beforeEach(({}, testInfo) => {
  const reason = phoneSkipReason(testInfo)
  test.skip(reason !== null, reason ?? '')
})

const OFFLINE_TEXT = /Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_FAILED|network connection|offline|Load failed/i

/** Every request fails while the phone has no signal; these are the browser's own reports of it. */
function offlineGuards(page: Page, allowCrashText?: readonly string[]) {
  return phoneGuards(page, {
    failures: [
      { url: /^http:\/\/localhost:3000\//, text: OFFLINE_TEXT },
      ...expectedFaultConsoleErrors('rest/v1/patients'),
      { url: new RegExp(`^${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), text: OFFLINE_TEXT },
    ],
    allowCrashText,
  })
}

/** The message as the user sees it: a toast, or the form's own inline alert. */
function message(page: Page, text: string | RegExp) {
  // By text: a toast raised from inside a modal dialog is aria-hidden to role queries.
  return page.getByText(text).filter({ visible: true }).first()
}

// ---------------------------------------------------------------------------------------------
// M-7 No signal at the tap
// ---------------------------------------------------------------------------------------------

for (const flowId of ['session-notes', 'reminder', 'payment', 'patient'] as const satisfies readonly FlowId[]) {
  const flow = FLOWS[flowId]
  test(`M-7 with no signal, a tap to ${flow.title} says so, keeps the input, and saves once when back online`, async ({ page, context, factory }, testInfo) => {
    const reason = phoneSkipReason(testInfo, flow)
    test.skip(reason !== null, reason ?? '')
    const guards = offlineGuards(page)
    const open = await flow.open(page, factory)
    await open.fill()

    await context.setOffline(true)
    await open.submit.tap()
    const expected = flow.transport === 'supabase' ? NETWORK_ERROR_MESSAGE : ACTION_UNREACHABLE_MESSAGE
    await expectInViewport(message(page, expected))
    await expect(open.submit).toBeEnabled()
    await expect(open.submit).toHaveAccessibleName(open.idleName)
    await open.expectFilled()
    expect(await open.rows()).toBe(0)

    await context.setOffline(false)
    await open.submit.tap()
    await open.expectSaved()
    await expect.poll(() => open.rows()).toBe(1)
    await guards.assertClean()
  })
}

test('M-7 with no signal, a status change says so, stays as it was, and goes through when back online', async ({ page, context, factory }) => {
  const guards = offlineGuards(page)
  const status = await openStatusFlow(page, factory)

  await context.setOffline(true)
  await status.choose('Completed')
  await expectInViewport(message(page, ACTION_UNREACHABLE_MESSAGE))
  await expect(status.trigger).toHaveText('Scheduled')
  expect(await status.status()).toBe('scheduled')

  await context.setOffline(false)
  await status.choose('Completed')
  await expect(page.getByText('Status updated', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect.poll(() => status.status()).toBe('completed')
  await guards.assertClean()
})

test('M-7 with no signal, a booking is held for a check, keeps the input, and books once when back online', async ({ page, context, factory }) => {
  const guards = offlineGuards(page)
  const open = await FLOWS['book-schedule'].open(page, factory)
  await open.fill()

  await context.setOffline(true)
  await open.submit.tap()
  const recovery = page.getByRole('alert').filter({ hasText: 'Booking not confirmed' })
  await expect(recovery).toBeVisible()
  await recovery.scrollIntoViewIfNeeded()
  await expectInViewport(recovery.getByRole('button', { name: 'Check booking', exact: true }))
  await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toHaveCount(0)
  await open.expectFilled()
  expect(await open.rows()).toBe(0)

  await context.setOffline(false)
  await recovery.getByRole('button', { name: 'Check booking', exact: true }).tap()
  await expect(recovery).toContainText('No saved appointment found')
  await recovery.getByRole('button', { name: 'Retry same booking', exact: true }).tap()
  await open.expectSaved()
  await expect.poll(() => open.rows()).toBe(1)
  await guards.assertClean()
})

test('M-7 a resume with no signal does not crash or sign out, and the screen catches up once back online', async ({ page, context, factory }) => {
  // NEW-M7 (found by this package, no G-id yet): resume-refresh.tsx calls router.refresh() even
  // when the version check failed for lack of signal; the RSC fetch fails, Next falls back to a
  // full browser navigation, and with no signal the phone is left on a blank error page instead
  // of the app it was showing.
  test.fail(true, 'NEW-M7: a resume with no signal navigates away to the browser offline page')
  const guards = offlineGuards(page)
  const date = clinicDate(163)
  await page.clock.install()
  await page.goto(`/schedule?date=${date}`)
  const heading = page.getByRole('heading', { name: 'Schedule', exact: true }).filter({ visible: true })
  await expect(heading).toBeVisible()
  // The heading is server-rendered; wait for hydration so the resume listener is attached.
  await page.waitForLoadState('networkidle')

  const patient = await factory.createPatient()
  await factory.createAppointment({ patientId: patient.id, date, time: '10:55' })
  await context.setOffline(true)
  await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
  await expect(heading).toBeVisible()
  await expect(page).toHaveURL(`/schedule?date=${date}`)

  await context.setOffline(false)
  const same = await serveAppVersion(page, E2E_APP_VERSION)
  await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
  await expect(page.getByText(patient.name as string, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page).toHaveURL(`/schedule?date=${date}`)
  expect(same.count()).toBe(1)
  await guards.assertClean()
})

// ---------------------------------------------------------------------------------------------
// M-8 Signal drops after the server saved (the reply is lost)
// ---------------------------------------------------------------------------------------------

test('M-8 a payment whose reply is lost says to check before retrying, and after a reload it is there once', async ({ page, factory }, testInfo) => {
  const reason = phoneSkipReason(testInfo, FLOWS.payment)
  test.skip(reason !== null, reason ?? '')
  const guards = phoneGuards(page)
  const open = await FLOWS.payment.open(page, factory)
  await open.fill()

  const fault = await failNextServerAction(page, 'lost-response')
  await open.submit.tap()
  await expect.poll(() => fault.hit()).toBe(true)
  await expectInViewport(message(page, ACTION_UNREACHABLE_MESSAGE))
  await expect(open.submit).toBeEnabled()
  await fault.dispose()
  await expect.poll(() => open.rows()).toBe(1)

  await page.goto('/billing?tab=payments')
  await expect(page.getByRole('heading', { name: 'Billing', exact: true }).filter({ visible: true })).toBeVisible()
  expect(await open.rows()).toBe(1)
  await guards.assertClean()
})

test('M-8 a booking whose reply is lost says to check before retrying, and after a reload it is there once', async ({ page, factory }) => {
  const guards = phoneGuards(page)
  const open = await FLOWS['book-schedule'].open(page, factory)
  await open.fill()

  let sends = 0
  // Every send reaches the server and commits; every reply is lost on the way back.
  await page.route((url) => url.pathname === BOOKINGS_PATH, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    sends += 1
    await route.fetch()
    await route.abort('failed')
  })
  await open.submit.tap()
  const recovery = page.getByRole('alert').filter({ hasText: 'Booking not confirmed' })
  await expect(recovery).toContainText('Check the booking before trying again')
  await expectInViewport(recovery.getByRole('button', { name: 'Check booking', exact: true }))
  expect(sends).toBeGreaterThan(0)
  await expect.poll(() => open.rows()).toBe(1)

  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true }).filter({ visible: true })).toBeVisible()
  expect(await open.rows()).toBe(1)
  await guards.assertClean()
})
