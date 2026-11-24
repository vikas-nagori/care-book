// Coming back to the phone app with work half done (plan 5.7: M-3, M-4, M-5). Every return from
// the background after a minute refreshes the screen (resume-refresh.tsx), many times a day, so
// an open form, an in-flight save and rows loaded on the device must all survive it.
//
// Desktop projects skip this whole file (the beforeEach below): it is about the phone app.

import type { Page, Route } from '@playwright/test'

import type { BookingRequest } from '../../src/lib/appointments/booking-contract'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'
import { expectedFaultConsoleErrors, holdNextServerAction, holdNextSupabaseCall, type HoldHandle } from '../support/fault-injection'
import { E2E_APP_VERSION, backgroundApp, projectRole, serveAppVersion } from '../support/mobile'
import { BOOKINGS_PATH, FLOWS, phoneGuards, phoneSkipReason, type FlowId } from './mobile-flows'

test.use({ serviceWorkers: 'block' })

test.beforeEach(({}, testInfo) => {
  const reason = phoneSkipReason(testInfo)
  test.skip(reason !== null, reason ?? '')
})

const FORM_FLOWS = ['book-schedule', 'book-dashboard', 'session-notes', 'reminder', 'patient', 'payment'] as const satisfies readonly FlowId[]

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

function pathnameOf(path: string) {
  return new URL(path, 'http://localhost').pathname
}

// ---------------------------------------------------------------------------------------------
// M-3 Resume with unsaved input
// ---------------------------------------------------------------------------------------------

for (const flowId of FORM_FLOWS) {
  const flow = FLOWS[flowId]

  test(`M-3 a resume on the same build keeps the open form to ${flow.title} with every typed value, and one submit saves once`, async ({ page, factory }, testInfo) => {
    const reason = phoneSkipReason(testInfo, flow)
    test.skip(reason !== null, reason ?? '')
    const guards = phoneGuards(page)
    await page.clock.install()
    const open = await flow.open(page, factory)
    await open.fill()

    const same = await serveAppVersion(page, E2E_APP_VERSION)
    const refreshed = waitForRefresh(page, pathnameOf(open.path))
    await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
    await refreshed
    expect(same.count()).toBe(1)
    await expect(open.container).toBeVisible()
    await open.expectFilled()
    expect(await open.rows()).toBe(0)

    await open.submit.tap()
    await open.expectSaved()
    await expect.poll(() => open.rows()).toBe(1)
    await same.dispose()
    await guards.assertClean()
  })

  test(`M-3 a resume onto a newer build with the form to ${flow.title} open reloads once, signed in on the same route, and saves nothing`, async ({ page, factory }, testInfo) => {
    const reason = phoneSkipReason(testInfo, flow)
    test.skip(reason !== null, reason ?? '')
    const guards = phoneGuards(page)
    await page.clock.install()
    const open = await flow.open(page, factory)
    await open.fill()
    const before = new URL(page.url())
    let loads = 0
    page.on('load', () => { loads += 1 })

    // Decision D6: the reload happens at once and the typed input is lost; that is accepted.
    const newer = await serveAppVersion(page, `${E2E_APP_VERSION}-next`)
    const reloaded = page.waitForEvent('load')
    await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
    await reloaded
    await page.waitForLoadState('networkidle')
    expect(loads).toBe(1)
    expect(newer.count()).toBe(1)
    expect(new URL(page.url()).pathname).toBe(before.pathname)
    await expect(page).not.toHaveURL(/\/login/)
    // Signed in: the screen's own form can be opened again.
    await open.openForm()
    expect(await open.rows()).toBe(0)
    await newer.dispose()
    await guards.assertClean()
  })
}

// ---------------------------------------------------------------------------------------------
// M-4 Resume while a save is in flight
// ---------------------------------------------------------------------------------------------

for (const flowId of ['session-notes', 'reminder', 'patient', 'payment'] as const satisfies readonly FlowId[]) {
  const flow = FLOWS[flowId]
  test(`M-4 a resume while saving ${flow.title} lets the save finish once, with no second request`, async ({ page, factory }, testInfo) => {
    const reason = phoneSkipReason(testInfo, flow)
    test.skip(reason !== null, reason ?? '')
    const guards = phoneGuards(page, { failures: expectedFaultConsoleErrors('rest/v1/patients') })
    await page.clock.install()
    const open = await flow.open(page, factory)
    await open.fill()

    const hold: HoldHandle = flow.transport === 'supabase'
      ? await holdNextSupabaseCall(page, { resource: 'rest/v1/patients', method: 'POST' })
      : await holdNextServerAction(page)
    await open.submit.tap()
    await hold.whenHeld()
    await expect(open.submit).toBeDisabled()
    await expect(open.submit).not.toHaveAccessibleName(open.idleName)

    const same = await serveAppVersion(page, E2E_APP_VERSION)
    await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
    await expect.poll(() => same.count()).toBe(1)
    expect(await open.rows()).toBe(0)

    await hold.release()
    await open.expectSaved()
    await expect.poll(() => open.rows()).toBe(1)
    expect(hold.count(), 'the resume sent the save a second time').toBe(1)
    await same.dispose()
    await guards.assertClean()
  })
}

test('M-4 a resume while booking lets the booking finish once; any resend is the same booking', async ({ page, factory }) => {
  const guards = phoneGuards(page)
  await page.clock.install()
  const open = await FLOWS['book-schedule'].open(page, factory)
  await open.fill()

  const writes: BookingRequest[] = []
  let held: Route | null = null
  let onHeld!: () => void
  const whenHeld = new Promise<void>((resolve) => { onHeld = resolve })
  await page.route((url) => url.pathname === BOOKINGS_PATH, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    writes.push(route.request().postDataJSON() as BookingRequest)
    if (!held) { held = route; onHeld(); return }
    await route.fallback()
  })
  await open.submit.tap()
  await whenHeld
  await expect(open.submit).toBeDisabled()

  const same = await serveAppVersion(page, E2E_APP_VERSION)
  await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
  await expect.poll(() => same.count()).toBe(1)
  await (held as Route | null)!.fallback()

  // Timers that fell due while the phone slept fire together on resume, so the form may already
  // have given up waiting and show its "Booking not confirmed" check (the designed recovery for a
  // reply it never saw). Either way the button is not stuck and one tap settles it.
  // The held send was abandoned by its deadline, so it may never land; the recovery panel's
  // Check booking then finds nothing and Retry same booking resends the identical booking.
  const recovery = page.getByRole('alert').filter({ hasText: 'Booking not confirmed' })
  await expect(recovery.or(page.getByText('Appointment booked', { exact: true })).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toHaveCount(0)
  if (await recovery.isVisible()) {
    await recovery.getByRole('button', { name: 'Check booking', exact: true }).tap()
    const retry = recovery.getByRole('button', { name: 'Retry same booking', exact: true })
    await expect(retry.or(page.getByText('Appointment booked', { exact: true })).first()).toBeVisible()
    if (await retry.isVisible()) await retry.tap()
  }
  await open.expectSaved()
  await expect.poll(() => open.rows()).toBe(1)
  // The form resends a booking stuck on a dead connection (by design); every send is the same
  // booking, so the server keeps one.
  expect(new Set(writes.map((write) => write.correlationId)).size).toBe(1)
  await same.dispose()
  await guards.assertClean()
})

// ---------------------------------------------------------------------------------------------
// M-5 Resume on screens that keep data loaded on the device (admin phone)
// ---------------------------------------------------------------------------------------------

test.describe('M-5 resume keeps what the device loaded', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(projectRole(testInfo) !== 'admin', 'admin-only screens (billing) and one phone project is enough')
  })

  test('M-5 billing Payments: rows added by Load more stay after a resume (G-6)', async ({ page, factory }) => {
    // G-6: billing-view.tsx resets `payments` to the server's first page whenever the page props
    // change, so the resume refresh drops every row "Load more" fetched.
    test.fail(true, 'G-6: loaded-more payments vanish after the resume refresh')
    const guards = phoneGuards(page)
    const patient = await factory.createPatient()
    await factory.createPayments(60, { patientId: patient.id, startDayOffset: -500 })
    await page.clock.install()
    await page.goto('/billing?tab=payments')
    await page.getByRole('button', { name: /^View more \(\d+ more\)$/ }).tap()
    await page.getByRole('button', { name: /^Load more \(\d+ remaining\)$/ }).tap()
    const mine = page.getByRole('button', { name: `Cancel payment for ${patient.name} · ₹750`, exact: true }).filter({ visible: true })
    await expect(mine).toHaveCount(60)

    // Recorded on another phone meanwhile: seeing it proves the refresh reached the screen.
    await factory.createPayment({ patientId: patient.id, amount: 1234, date: clinicDate() })
    const refreshed = waitForRefresh(page, '/billing')
    await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
    await refreshed
    await expect(page.getByRole('button', { name: `Cancel payment for ${patient.name} · ₹1,234`, exact: true }).filter({ visible: true })).toBeVisible()
    await expect(mine).toHaveCount(60)
    await guards.assertClean()
  })

  test('M-5 payment PDF: a resume mid-generation does not leave the button on Generating… (G-17e)', async ({ page, factory }) => {
    const guards = phoneGuards(page)
    const patient = await factory.createPatient()
    await factory.createAppointment({ patientId: patient.id, date: clinicDate(-3), time: '09:00', status: 'completed', fee: 800 })
    const due = page.locator('.ph-stat').filter({ hasText: 'Regular due' }).filter({ visible: true })
    await page.clock.install()
    await page.goto(`/billing/payment-due/${patient.id}`)
    await expect(due).toContainText('800')
    await page.getByRole('button', { name: 'Share payment PDF' }).filter({ visible: true }).tap()
    const dialog = page.getByRole('dialog', { name: 'Generate payment PDF' })
    await expect(dialog).toBeVisible()

    let held: Route | null = null
    let onHeld!: () => void
    const whenHeld = new Promise<void>((resolve) => { onHeld = resolve })
    await page.route((url) => /^\/api\/billing\/payment-due\/[^/]+\/pdf$/.test(url.pathname), async (route) => {
      if (!held) { held = route; onHeld(); return }
      await route.fallback()
    })
    await dialog.getByRole('button', { name: 'Generate PDF', exact: true }).tap()
    await whenHeld
    await expect(dialog.getByRole('button', { name: 'Generating…', exact: true })).toBeDisabled()

    // A second session completed meanwhile: the new due proves the refresh reached the screen
    // while the PDF request was still out.
    await factory.createAppointment({ patientId: patient.id, date: clinicDate(-2), time: '09:00', status: 'completed', fee: 777 })
    const refreshed = waitForRefresh(page, `/billing/payment-due/${patient.id}`)
    await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
    await refreshed
    await expect(due).toContainText('1,577')
    await (held as Route | null)!.fallback()
    await expect(dialog.getByRole('button', { name: /^(Generate again|Generate PDF)$/ })).toBeEnabled()
    await expect(dialog.getByRole('button', { name: 'Generating…', exact: true })).toHaveCount(0)
    await guards.assertClean()
  })

  test('M-5 patient list: rows added by Load more stay after a resume', async ({ page, factory }) => {
    const guards = phoneGuards(page)
    const created = await factory.createPatients(60)
    const token = created[0].name!.split(' ')[1]
    await page.clock.install()
    await page.goto('/patients')
    const more = page.getByRole('button', { name: /^Load more \(\d+ remaining\)$/ })
    const rows = page.getByRole('link').filter({ hasText: token }).filter({ visible: true })
    // Load pages until every one of this test's patients is on the device.
    for (let before = await rows.count(); before < 60; before = await rows.count()) {
      await more.tap()
      await expect.poll(() => rows.count()).toBeGreaterThan(before)
    }
    await expect(rows).toHaveCount(60)

    // Added on another phone meanwhile: the list's total grows, which proves the refresh landed.
    await factory.createPatient()
    const refreshed = waitForRefresh(page, '/patients')
    await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
    await refreshed
    await expect(page.getByRole('button', { name: 'Load more (1 remaining)', exact: true })).toBeVisible()
    await expect(rows).toHaveCount(60)
    await guards.assertClean()
  })

  test('M-5 schedule: a date tapped inside the loaded weeks is kept after a resume', async ({ page, factory }) => {
    const guards = phoneGuards(page)
    const patient = await factory.createPatient()
    const start = clinicDate(161), next = clinicDate(162)
    await factory.createAppointment({ patientId: patient.id, date: next, time: '09:35' })
    const label = new Intl.DateTimeFormat('en', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      .format(new Date(`${next}T00:00:00.000Z`))
    await page.clock.install()
    await page.goto(`/schedule?date=${start}`)
    await page.getByRole('button', { name: new RegExp(`^${label}, `) }).filter({ visible: true }).tap()
    await expect(page).toHaveURL(new RegExp(`date=${next}`))
    const booked = page.getByText(patient.name as string, { exact: true }).filter({ visible: true }).first()
    await expect(booked).toBeVisible()

    // Booked on another phone meanwhile, on the chosen day: it shows once the refresh lands.
    const other = await factory.createPatient()
    await factory.createAppointment({ patientId: other.id, date: next, time: '12:35' })
    const refreshed = waitForRefresh(page, '/schedule')
    await backgroundApp(page, { minutes: 2, clockAlreadyInstalled: true })
    await refreshed
    await expect(page.getByText(other.name as string, { exact: true }).filter({ visible: true }).first()).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`date=${next}`))
    await expect(booked).toBeVisible()
    await guards.assertClean()
  })
})
