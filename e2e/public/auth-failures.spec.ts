// Sign-in, reset and first-password screens when the request never gets an answer (plan 5.4,
// SA-13). Each control must show a plain-language message, come back enabled, and work on retry.
// The browser talks to Supabase Auth directly for sign-in, reset and update-password, and to a
// server action for the invite, forced-change and clinic-request forms. Throwaway users only.

import type { Locator, Page } from '@playwright/test'
import { attachErrorGuards } from '../support/assertions'
import { test, expect, type E2EFactory } from '../support/factories'
import {
  ACTION_UNREACHABLE_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  expectButtonRecovers,
  expectedFaultConsoleErrors,
  failNextServerAction,
  failNextSupabaseCall,
  type FaultHandle,
  type SupabaseResource,
} from '../support/fault-injection'
import { adminClient } from '../support/supabase-admin'

// Faults must reach Playwright's router, not the service worker.
test.use({ serviceWorkers: 'block' })

function guardsFor(page: Page, target: 'server-action' | SupabaseResource) {
  return attachErrorGuards(page, {
    expectedFailures: [
      ...expectedFaultConsoleErrors(target),
      // supabase-js (auth-js) console.errors the fetch rejection itself before returning it as
      // an AuthRetryableFetchError; only for the injected Supabase Auth faults.
      ...(target === 'server-action'
        ? []
        : [{ url: /^http:\/\/localhost:3000\/_next\/static\/chunks\//, text: /^TypeError: Failed to fetch\n[\s\S]*\b(?:signInWithPassword|resetPasswordForEmail|updateUser|_updateUser)\b/ }]),
      // The local server answers the Vercel Analytics script request with a redirect to an app
      // page once the invitee is signed in; the observability filter in support/assertions.ts
      // misses it when the console line arrives before the response event (seen locally on
      // public-mobile after Finish Sign-Up).
      { url: /^http:\/\/localhost:3000\//, text: /^Refused to execute script from 'http:\/\/localhost:3000\/[a-z/-]*' because its MIME type \('text\/html'\) is not executable/ },
    ],
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }],
  })
}

/**
 * These forms print their error as plain text under the form (not a toast or alert), so check the
 * text itself, then that the button is idle and enabled again and the fault really fired.
 */
async function expectInlineRecovery(page: Page, button: Locator, input: { idleName: string; message: string; fault: FaultHandle }) {
  await expect.poll(() => input.fault.hit(), { message: 'the injected fault never fired' }).toBe(true)
  await expect(page.getByText(input.message, { exact: true })).toBeVisible()
  await expect(button).toBeVisible()
  await expect(button).toBeEnabled()
  await expect(button).toHaveAccessibleName(input.idleName)
}

async function throwawayUser(factory: E2EFactory) {
  const clinic = await factory.createClinic()
  return factory.createAuthUser({ clinicId: clinic.id })
}

test('SA-13: Sign In with no answer from Auth says so, re-enables, and the retry signs in', async ({ page, factory }) => {
  const guards = guardsFor(page, 'auth/v1/token')
  const user = await throwawayUser(factory)
  await page.goto('/login')
  await page.getByLabel('Mobile number', { exact: true }).fill(user.mobileNumber)
  await page.getByLabel('Password').fill(user.password)
  const button = page.getByRole('button', { name: /^(Sign In|Signing in\.\.\.)$/ })

  const fault = await failNextSupabaseCall(page, { resource: 'auth/v1/token', method: 'POST', mode: 'abort' })
  await button.click()
  await expectInlineRecovery(page, button, { idleName: 'Sign In', message: NETWORK_ERROR_MESSAGE, fault })
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByLabel('Password')).toHaveValue(user.password)

  await fault.dispose()
  await button.click()
  await expect(page).toHaveURL('http://localhost:3000/')
  await guards.assertClean()
})

test('SA-13: Send Reset Link with no answer from Auth says so, re-enables, and the retry sends it', async ({ page, factory }) => {
  const guards = guardsFor(page, 'auth/v1/recover')
  const user = await throwawayUser(factory)
  const before = (await factory.getAuthUser(user.id)).recovery_sent_at
  await page.goto('/login')
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click()
  await page.getByLabel('Email').fill(user.email)
  const button = page.getByRole('button', { name: /^(Send Reset Link|Sending\.\.\.)$/ })

  const fault = await failNextSupabaseCall(page, { resource: 'auth/v1/recover', method: 'POST', mode: 'abort' })
  await button.click()
  await expectInlineRecovery(page, button, { idleName: 'Send Reset Link', message: NETWORK_ERROR_MESSAGE, fault })
  expect((await factory.getAuthUser(user.id)).recovery_sent_at).toBe(before)

  await fault.dispose()
  await button.click()
  await expect(page.getByText('If an account exists for that email, a reset link has been sent.', { exact: true })).toBeVisible()
  await expect.poll(async () => (await factory.getAuthUser(user.id)).recovery_sent_at).not.toBe(before)
  await guards.assertClean()
})

test('SA-13: Update Password with no answer from Auth says so, re-enables, and the retry saves it', async ({ page, factory }) => {
  const guards = guardsFor(page, 'auth/v1/user')
  const user = await throwawayUser(factory)
  const recovery = await factory.createRecoveryAction(user.email)
  await page.addInitScript(() => window.localStorage.setItem('care-book:guided-tour-seen', 'true'))
  await page.goto(recovery.actionLink)
  await expect(page).toHaveURL('http://localhost:3000/auth/update-password')
  const newPassword = `E2e-${factory.token}-Upd8`
  await page.getByLabel('New password', { exact: true }).fill(newPassword)
  await page.getByLabel('Confirm password', { exact: true }).fill(newPassword)
  const button = page.getByRole('button', { name: /^(Update Password|Updating password…)$/ })

  const fault = await failNextSupabaseCall(page, { resource: 'auth/v1/user', method: 'PUT', mode: 'abort' })
  await button.click()
  await expectInlineRecovery(page, button, { idleName: 'Update Password', message: NETWORK_ERROR_MESSAGE, fault })
  await expect(page).toHaveURL('http://localhost:3000/auth/update-password')

  await fault.dispose()
  await button.click()
  await expect(page).toHaveURL('http://localhost:3000/')
  await guards.assertClean()
})

test('SA-13: Finish Sign-Up with no answer says so, keeps the invite pending, and the retry completes it', async ({ page, factory }) => {
  const guards = guardsFor(page, 'server-action')
  const clinic = await factory.createClinic()
  const pending = await factory.createInviteAction({ clinicId: clinic.id })
  await page.goto(pending.actionLink)
  await expect(page).toHaveURL('http://localhost:3000/auth/complete-invite')
  const password = `E2e-${factory.token}-F1nish`
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password', { exact: true }).fill(password)
  const button = page.getByRole('button', { name: /^(Finish Sign-Up|Saving account…)$/ })

  const fault = await failNextServerAction(page, 'abort')
  await button.click()
  await expectInlineRecovery(page, button, { idleName: 'Finish Sign-Up', message: ACTION_UNREACHABLE_MESSAGE, fault })
  expect(await factory.findInviteByEmail(pending.email)).toMatchObject({ status: 'pending' })

  await fault.dispose()
  await button.click()
  await expect(page).toHaveURL('http://localhost:3000/login?invite=complete')
  await expect.poll(async () => (await factory.findInviteByEmail(pending.email))?.status).toBe('accepted')
  await guards.assertClean()
})

test('SA-13: Save New Password with no answer says so, keeps the temporary password, and the retry sets it', async ({ page, factory }) => {
  const guards = guardsFor(page, 'server-action')
  const user = await throwawayUser(factory)
  const { error } = await adminClient().auth.admin.updateUserById(user.id, { app_metadata: { must_change_password: true } })
  if (error) throw new Error(`arm forced password change: ${error.message}`)
  await page.goto('/login')
  await page.getByLabel('Mobile number', { exact: true }).fill(user.mobileNumber)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await page.waitForURL('**/auth/change-password', { timeout: 15_000 })
  const password = `E2e-${factory.token}-S4ve`
  await page.getByLabel('New password', { exact: true }).fill(password)
  await page.getByLabel('Confirm new password', { exact: true }).fill(password)
  const button = page.getByRole('button', { name: /^(Save New Password|Saving password…)$/ })

  const fault = await failNextServerAction(page, 'abort')
  await button.click()
  await expectInlineRecovery(page, button, { idleName: 'Save New Password', message: ACTION_UNREACHABLE_MESSAGE, fault })
  expect((await factory.getAuthUser(user.id)).app_metadata?.must_change_password).toBe(true)

  await fault.dispose()
  // Enter, not a click: success navigates away while the button is disabled.
  await page.getByLabel('Confirm new password', { exact: true }).press('Enter')
  await page.waitForURL('http://localhost:3000/', { timeout: 15_000 })
  await expect.poll(async () => (await factory.getAuthUser(user.id)).app_metadata?.must_change_password).toBe(false)
  await guards.assertClean()
})

test('SA-13: Submit Request with no answer says so, saves nothing, and the retry submits it', async ({ page, factory }) => {
  const guards = guardsFor(page, 'server-action')
  const clinicName = factory.uniqueName('abort-clinic')
  const ownerEmail = factory.uniqueEmail('abort-onboarding')
  factory.watchUiOnboardingRequest({ ownerEmail, clinicName })
  await page.goto('/clinic-onboarding')
  await page.getByLabel('Clinic name').fill(clinicName)
  await page.getByLabel('Owner name').fill(factory.uniqueName('abort-owner'))
  await page.getByLabel('Owner email').fill(ownerEmail)
  await page.getByLabel('Owner mobile').fill(factory.uniqueMobile())
  const button = page.getByRole('button', { name: /^(Submit Request|Submitting…)$/ })

  const fault = await failNextServerAction(page, 'abort')
  await button.click()
  await expectButtonRecovers(button, { idleName: 'Submit Request', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(page.getByLabel('Clinic name')).toHaveValue(clinicName)
  expect(await factory.findOnboardingRequestByEmail(ownerEmail)).toBeNull()

  await fault.dispose()
  await button.click()
  await expect(page.getByText('Your request has been submitted for review.', { exact: false })).toBeVisible()
  await expect.poll(async () => (await factory.findOnboardingRequestByEmail(ownerEmail))?.status).toBe('pending')
  await guards.assertClean()
})
