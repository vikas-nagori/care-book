// What an External Staff session may reach (plan 5.5, X-12, X-13): every clinic write and every
// platform page is refused, and an account blocked mid-session gets the "Account unavailable"
// notice with a working Log out.

import type { Page } from '@playwright/test'

import { EXTERNAL_OBSERVABILITY_REDIRECT_NOISE, press, signInWithMobile } from '../pages/external-dialogs'
import { CLINIC_A } from '../support/accounts'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect, type E2EFactory } from '../support/factories'
import {
  ACTION_UNREACHABLE_MESSAGE,
  expectButtonRecovers,
  expectedFaultConsoleErrors,
  failNextServerAction,
} from '../support/fault-injection'
import { SEED } from '../support/ids'
import { adminClient } from '../support/supabase-admin'
import { EXTERNAL_ACCESS_MESSAGE } from '../../src/lib/external/workspace'

// Faults must reach Playwright's router, not the service worker.
test.use({ serviceWorkers: 'block' })

const FORBIDDEN = { errorCode: 'FORBIDDEN', message: 'This area is unavailable for your account.' }

function guardsFor(page: Page) {
  return attachErrorGuards(page, {
    expectedFailures: [...expectedFaultConsoleErrors('server-action'), ...EXTERNAL_OBSERVABILITY_REDIRECT_NOISE],
    // reportClientError's telemetry budget can answer 429 when the matrix runs back to back.
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }],
  })
}

test('External Staff are refused clinic writes and platform pages', async ({ page }) => {
  const guards = guardsFor(page)
  const writes: [string, unknown][] = [
    ['/api/appointments/bookings', {
      patient_id: SEED.patientExternal, date: clinicDate(3), time: '10:00', duration_minutes: 30,
    }],
    [`/api/billing/payment-due/${SEED.patientPaymentDue}/pdf`, { scope: 'all' }],
    ['/patients', { name: 'Should never be saved' }],
  ]
  for (const [path, data] of writes) {
    const response = await page.request.post(path, { data, maxRedirects: 0 })
    expect(response.status(), `POST ${path}`).toBe(403)
    expect(response.headers()['content-type'], `POST ${path}`).toContain('application/json')
    expect(await response.json(), `POST ${path}`).toEqual(FORBIDDEN)
  }

  for (const path of ['/platform', '/platform/users']) {
    const response = await page.goto(path)
    expect(response?.ok(), `GET ${path}`).toBe(true)
    expect(response?.request().redirectedFrom(), `GET ${path} should redirect`).not.toBeNull()
    await expect(page).toHaveURL(/\/external$/)
    await expect(page.getByRole('heading', { name: 'Schedule', exact: true }).filter({ visible: true }).first()).toBeVisible()
    await expectNoLeakedNulls(page)
  }
  await guards.assertClean()
})

// G-26: a blocked account's own profile row is hidden by RLS, so the root layout used to see "no
// profile" and draw the clinic navigation (Dashboard, Schedule, Patients, Settings) around the
// Account unavailable notice, the error screen and every other page. Every clinic link only
// bounced back to /external. The error boundary (src/app/error.tsx) renders inside the same root
// layout, so it shows exactly the navigation checked here; the not-found screen stands in for it
// as a framework screen that a blocked user can reach on purpose.
const CLINIC_NAV_LINKS = ['Dashboard', 'Schedule', 'Patients', 'Billing', 'Settings'] as const

async function expectNoClinicNavigation(page: Page) {
  for (const name of CLINIC_NAV_LINKS) {
    await expect(page.getByRole('link', { name, exact: true }), `"${name}" navigation link`).toHaveCount(0)
  }
  for (const href of ['/', '/schedule', '/patients', '/billing', '/settings']) {
    await expect(page.locator(`a[href="${href}"]`), `link to ${href}`).toHaveCount(0)
  }
}

test('a blocked External Staff account is never shown the clinic navigation', async ({ page, factory }) => {
  const guards = attachErrorGuards(page, {
    expectedFailures: EXTERNAL_OBSERVABILITY_REDIRECT_NOISE,
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }, { pathname: '/external/no-such-page', status: 404 }],
  })
  await blockedExternalUser(page, factory)

  const missing = await page.goto('/external/no-such-page')
  expect(missing?.status()).toBe(404)
  await expect(page.getByText('This page could not be found', { exact: false })).toBeVisible()
  await expectNoClinicNavigation(page)

  for (const path of ['/external', '/external/patients', '/external/account']) {
    await page.goto(path)
    await expect(page.getByText('Account unavailable', { exact: true })).toBeVisible()
    await expectNoClinicNavigation(page)
    await expectNoLeakedNulls(page)
  }

  // A clinic route still lands on the notice, and nothing on it leads back into the clinic.
  await page.goto('/schedule')
  await expect(page).toHaveURL(/\/external$/)
  await expect(page.getByText('Account unavailable', { exact: true })).toBeVisible()
  await expectNoClinicNavigation(page)
  await guards.assertClean()
})

/** A disposable External Staff login, signed in on `page`, then blocked behind its back. */
async function blockedExternalUser(page: Page, factory: E2EFactory) {
  const user = await factory.createAuthUser({ clinicId: CLINIC_A.id, role: 'external_staff' })
  await signInWithMobile(page, { mobileNumber: user.mobileNumber })
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true }).filter({ visible: true }).first()).toBeVisible()
  const { error } = await adminClient().from('profiles').update({ status: 'blocked' }).eq('id', user.id)
  expect(error).toBeNull()
  await page.reload()
  await expect(page.getByText('Account unavailable', { exact: true })).toBeVisible()
  return user
}

test('a blocked External Staff account sees Account unavailable on every page and can still log out', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  await blockedExternalUser(page, factory)
  for (const path of ['/external', '/external/patients', '/external/account']) {
    await page.goto(path)
    await expect(page.getByText('Account unavailable', { exact: true })).toBeVisible()
    await expect(page.getByText(EXTERNAL_ACCESS_MESSAGE, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New appointment', exact: true })).toHaveCount(0)
    await expectNoLeakedNulls(page)
  }

  await press(page.getByRole('button', { name: 'Log out', exact: true }), testInfo)
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await page.goto('/external')
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await guards.assertClean()
})

// G-15: Log out is a native <form action>, outside callServerAction, so a dropped request is not
// turned into a message. The correct behaviour is pinned here; remove test.fail when G-15 is fixed.
test.fail('G-15: a dropped Log out request on Account unavailable tells the user and keeps the button usable', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  await blockedExternalUser(page, factory)
  const logout = page.getByRole('button', { name: 'Log out', exact: true })
  const fault = await failNextServerAction(page, 'abort')
  await press(logout, testInfo)
  await expectButtonRecovers(logout, { idleName: 'Log out', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(page).toHaveURL(/\/external$/)
  await expect(page.getByText('Account unavailable', { exact: true })).toBeVisible()
  await fault.dispose()
  await press(logout, testInfo)
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await guards.assertClean()
})
