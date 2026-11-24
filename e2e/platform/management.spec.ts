// Platform console: approve / reject clinic requests, block clinics and users, reset passwords.
// Every test that approves, rejects, blocks or resets works on throwaway clinics, requests and
// users from the factory; the seeded shared accounts and the F3 sparse rows are only looked at.

import { createClient } from '@supabase/supabase-js'
import type { Locator, Page } from '@playwright/test'

import { formatMobileNumber } from '../../src/lib/auth/mobile-number.ts'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { PASSWORD } from '../support/accounts'
import {
  ACTION_UNREACHABLE_MESSAGE,
  expectButtonRecovers,
  expectedFaultConsoleErrors,
  failNextServerAction,
  holdNextServerAction,
  type FaultHandle,
} from '../support/fault-injection'
import { SPARSE_NAMES, SPARSE_PROFILES } from '../support/ids'
import { useEmailSignIn } from '../support/login'
import { adminClient } from '../support/supabase-admin'
import { test, expect, type E2EFactory } from '../support/factories'

// Faults must reach Playwright's router, not the service worker.
test.use({ serviceWorkers: 'block' })

function isFutureBan(bannedUntil: string | undefined): boolean {
  return Boolean(bannedUntil && Date.parse(bannedUntil) > Date.now())
}

function faultGuards(page: Page) {
  return attachErrorGuards(page, {
    expectedFailures: expectedFaultConsoleErrors('server-action'),
    // reportClientError's telemetry budget can answer 429 when the matrix runs back to back.
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }],
  })
}

/**
 * Open a console page and let it finish loading before a fault route is installed. The Vercel
 * analytics scripts are DOM-injected after load and, for a superadmin, the middleware bounces
 * them to /platform; attachErrorGuards recognises that bounce from the redirect chain, which
 * Playwright does not expose while a catch-all page.route() is intercepting the request.
 */
async function gotoSettled(page: Page, path: string) {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
}

/** A console card (clinic or clinic request) found by its exact title. */
function card(page: Page, title: string): Locator {
  return page.locator('div.rounded-xl').filter({ has: page.getByText(title, { exact: true }) })
}

function toast(page: Page, title: string): Locator {
  return page.getByText(title, { exact: true }).filter({ visible: true })
}

/** The dropped request is reported, the button is back to idle, and its spinner is gone. */
async function expectAbortRecovered(button: Locator, idleName: string, fault: FaultHandle) {
  await expectButtonRecovers(button, { idleName, message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(button.locator('.animate-spin')).toHaveCount(0)
  expect(fault.hits()).toBe(1)
}

/** True when `password` still signs `email` in (a throwaway anon client; no session is kept). */
async function passwordWorks(email: string, password: string): Promise<boolean> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (!error) await client.auth.signOut({ scope: 'local' })
  return !error
}

/**
 * Register the owner login an approval created. watchUiInvite alone finds it only after the
 * profile delete, which the soft-delete guard refuses for a login not yet marked for cleanup.
 */
async function trackApprovedOwner(factory: E2EFactory, email: string) {
  const ownerId = (await factory.findInviteByEmail(email))?.auth_user_id
  if (!ownerId) throw new Error(`approved owner ${email} has no invite with an auth user`)
  factory.trackAuthUser(ownerId, email)
  factory.trackProfile(ownerId, email)
}

async function clinicsNamed(name: string): Promise<string[]> {
  const { data, error } = await adminClient().from('clinics').select('id').eq('name', name)
  if (error) throw new Error(`find clinics named ${name}: ${error.message}`)
  return (data ?? []).map((row) => row.id as string)
}

async function profileIdByMobile(mobile: string): Promise<string> {
  const { data, error } = await adminClient().from('profiles').select('id').eq('mobile_number', mobile).single()
  if (error || !data) throw new Error(`find sparse profile ${mobile}: ${error?.message ?? 'missing'}`)
  return data.id as string
}

test('approves a request, issues a temp password, and walks the owner through first login', async ({ page, factory, browser }) => {
  test.setTimeout(90_000)
  const guards = attachErrorGuards(page)
  const request = await factory.createOnboardingRequest()
  const email = String(request.owner_email)
  factory.watchUiOnboardingRequest({ ownerEmail: email, clinicName: String(request.clinic_name) })
  factory.watchUiInvite(email)

  await page.goto('/platform/clinic-requests')
  await page.getByRole('button', { name: `Approve ${request.clinic_name}`, exact: true }).click()
  await expect(page.getByText('Clinic approved', { exact: true }).filter({ visible: true })).toBeVisible()

  // Approval shows the owner's one-time temporary password — the only place it ever appears.
  await expect(page.getByText('Temporary password issued', { exact: true })).toBeVisible()
  const tempPassword = (await page.getByTestId('temp-password').textContent())!.trim()
  expect(tempPassword.length).toBeGreaterThanOrEqual(8)
  await page.getByRole('button', { name: 'Done', exact: true }).click()

  await expect.poll(async () => (await factory.findOnboardingRequestByEmail(email))?.status).toBe('approved')
  const approved = await factory.findOnboardingRequestByEmail(email)
  expect(approved?.clinic_id).toBeTruthy()
  const clinic = await factory.findClinicById(approved!.clinic_id!)
  expect(clinic).toMatchObject({ name: request.clinic_name, status: 'active' })
  const invite = await factory.findInviteByEmail(email)
  expect(invite).toMatchObject({ clinic_id: approved!.clinic_id, email, role: 'admin', status: 'pending' })
  expect(invite?.auth_user_id).toBeTruthy()
  const ownerAuthId = invite!.auth_user_id!
  factory.trackAuthUser(ownerAuthId, email)
  factory.trackProfile(ownerAuthId, email)
  const ownerAuthUser = await factory.getAuthUser(ownerAuthId)
  expect(ownerAuthUser.email).toBe(email)
  // No invite email — the account is born confirmed with the forced-change flag armed.
  expect(ownerAuthUser.app_metadata?.must_change_password).toBe(true)

  // The on_auth_user_created trigger writes an unprivileged placeholder (role 'staff', no
  // clinic). Approval must leave the owner as an admin of the clinic it just created, without
  // waiting for first login.
  const ownerProfile = await factory.findProfileById(ownerAuthId)
  expect(ownerProfile).toMatchObject({ role: 'admin', clinic_id: approved!.clinic_id })

  await page.goto('/platform/users')
  const ownerRow = page.getByTestId(`user-row-${ownerAuthId}`)
  await expect(ownerRow).toContainText('Admin')
  await expect(ownerRow).toContainText(String(clinic!.name))
  await expect(ownerRow).toContainText('invite pending')

  // First login with the temp password: middleware forces the change page before anything else.
  // `browser.newContext()` inherits the project's storageState (the platform admin session), so
  // the owner's context must start explicitly signed out.
  const ownerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const ownerPage = await ownerContext.newPage()
  const ownerGuards = attachErrorGuards(ownerPage)
  await ownerPage.goto('http://localhost:3000/login')
  await useEmailSignIn(ownerPage)
  await ownerPage.getByLabel('Email', { exact: true }).fill(email)
  await ownerPage.getByLabel('Password').fill(tempPassword)
  await ownerPage.getByRole('button', { name: 'Sign In', exact: true }).click()
  await ownerPage.waitForURL('**/auth/change-password', { timeout: 15_000 })

  const newPassword = `E2e-${factory.token}-Own3r`
  await ownerPage.getByLabel('New password', { exact: true }).fill(newPassword)
  await ownerPage.getByLabel('Confirm new password', { exact: true }).fill(newPassword)
  // Submit with Enter rather than clicking: success replaces the route while the button is in
  // its disabled loading state, which strands a pointer click's actionability loop (the click
  // has no timeout of its own and hangs the test).
  await ownerPage.getByLabel('Confirm new password', { exact: true }).press('Enter')
  await ownerPage.waitForURL((url) => url.pathname === '/', { timeout: 15_000 })
  // The first-run guided tour greets the owner on the dashboard (never earlier — on the forced
  // change page it would trap focus over the form). Dismiss it to prove the dashboard renders.
  await ownerPage.getByRole('button', { name: 'Skip tour', exact: true }).click({ timeout: 15_000 })
  await expect(ownerPage.getByRole('heading', { name: 'Today', exact: true })).toBeVisible({ timeout: 15_000 })
  await ownerGuards.assertClean()
  await ownerContext.close()

  // First password change doubles as invite acceptance: flag cleared, invite accepted, and the
  // owner name/mobile from the onboarding request synced onto the profile.
  await expect.poll(async () => (await factory.getAuthUser(ownerAuthId)).app_metadata?.must_change_password).toBe(false)
  await expect.poll(async () => (await factory.findInviteByEmail(email))?.status).toBe('accepted')
  expect(await factory.findProfileById(ownerAuthId)).toMatchObject({
    role: 'admin',
    clinic_id: approved!.clinic_id,
    full_name: request.owner_full_name,
    mobile_number: request.owner_mobile_number,
  })

  // The badge disappears once onboarding is complete.
  await page.goto('/platform/users')
  await expect(page.getByTestId(`user-row-${ownerAuthId}`)).not.toContainText('invite pending')
  await guards.assertClean()
})

test('re-issues a temp password for a user who never completed first login', async ({ page, factory, browser }) => {
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  // A legacy invite-email account: the auth user exists but its email is unconfirmed because
  // the invite link was never clicked. Issuing a temp password must still let them sign in.
  const pending = await factory.createInviteAction({ clinicId: clinic.id })
  expect((await factory.getAuthUser(pending.authUserId)).email_confirmed_at).toBeFalsy()

  await page.goto('/platform/users')
  const row = page.getByTestId(`user-row-${pending.authUserId}`)
  await expect(row).toContainText('invite pending')
  await row.getByRole('button', { name: `Issue temp password for ${pending.email}`, exact: true }).click()

  await expect(page.getByText('Temporary password issued', { exact: true })).toBeVisible()
  const tempPassword = (await page.getByTestId('temp-password').textContent())!.trim()
  await page.getByRole('button', { name: 'Done', exact: true }).click()

  // The re-issue overwrites the old password, arms the forced-change flag, and confirms the
  // email — GoTrue refuses password sign-in for unconfirmed addresses.
  await expect.poll(async () => (await factory.getAuthUser(pending.authUserId)).app_metadata?.must_change_password).toBe(true)
  expect((await factory.getAuthUser(pending.authUserId)).email_confirmed_at).toBeTruthy()

  const userContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const userPage = await userContext.newPage()
  await userPage.goto('http://localhost:3000/login')
  await useEmailSignIn(userPage)
  await userPage.getByLabel('Email', { exact: true }).fill(pending.email)
  await userPage.getByLabel('Password').fill(tempPassword)
  await userPage.getByRole('button', { name: 'Sign In', exact: true }).click()
  await userPage.waitForURL('**/auth/change-password', { timeout: 15_000 })
  await userContext.close()
  await guards.assertClean()
})

test('rejects a separate disposable onboarding request without creating a clinic', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const request = await factory.createOnboardingRequest()
  const reason = factory.uniqueName('rejection-reason')

  await page.goto('/platform/clinic-requests')
  await page.getByLabel(`Rejection reason for ${request.clinic_name}`, { exact: true }).fill(reason)
  await page.getByRole('button', { name: `Reject ${request.clinic_name}`, exact: true }).click()
  await expect(page.getByText('Request rejected', { exact: true }).filter({ visible: true })).toBeVisible()

  await expect.poll(async () => (await factory.findOnboardingRequestByEmail(String(request.owner_email)))?.status).toBe('rejected')
  expect(await factory.findOnboardingRequestByEmail(String(request.owner_email))).toMatchObject({
    clinic_id: null,
    rejection_reason: reason,
  })
  await guards.assertClean()
})

test('blocks and unblocks a disposable clinic and its auth user', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })

  await page.goto('/platform/clinics')
  await page.getByRole('button', { name: `Block clinic ${clinic.name}`, exact: true }).click()
  await expect(page.getByText('Clinic blocked', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect.poll(async () => (await factory.findClinicById(clinic.id))?.status).toBe('inactive')
  expect((await factory.findProfileById(user.id))?.status).toBe('active')
  await expect.poll(async () => isFutureBan((await factory.getAuthUser(user.id)).banned_until)).toBe(true)

  await page.getByRole('button', { name: `Unblock clinic ${clinic.name}`, exact: true }).click()
  await expect(page.getByText('Clinic unblocked', { exact: true }).filter({ visible: true })).toBeVisible({ timeout: 15_000 })
  await expect.poll(async () => (await factory.findClinicById(clinic.id))?.status).toBe('active')
  await expect.poll(async () => isFutureBan((await factory.getAuthUser(user.id)).banned_until)).toBe(false)
  await guards.assertClean()
})

test('blocks and unblocks a disposable user in profile and local auth', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })

  await page.goto('/platform/users')
  await page.getByRole('button', { name: `Block user ${user.email}`, exact: true }).click()
  await expect(page.getByText('User blocked', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect.poll(async () => (await factory.findProfileById(user.id))?.status).toBe('blocked')
  await expect.poll(async () => isFutureBan((await factory.getAuthUser(user.id)).banned_until)).toBe(true)

  await page.getByRole('button', { name: `Unblock user ${user.email}`, exact: true }).click()
  await expect(page.getByText('User unblocked', { exact: true }).filter({ visible: true })).toBeVisible({ timeout: 15_000 })
  await expect.poll(async () => (await factory.findProfileById(user.id))?.status).toBe('active')
  await expect.poll(async () => isFutureBan((await factory.getAuthUser(user.id)).banned_until)).toBe(false)
  await guards.assertClean()
})

test('sends a local password recovery request for a disposable user', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })
  const before = (await factory.getAuthUser(user.id)).recovery_sent_at

  await page.goto('/platform/users')
  await page.getByRole('button', { name: `Send reset for ${user.email}`, exact: true }).click()
  await expect(page.getByText('Reset link sent', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect.poll(async () => (await factory.getAuthUser(user.id)).recovery_sent_at).not.toBe(before)
  expect((await factory.getAuthUser(user.id)).recovery_sent_at).toBeTruthy()
  await guards.assertClean()
})

// ============================================================================================
// Sparse rows and minimal input (PL-1..PL-5)
// ============================================================================================

// Timeouts and test.fail() go through testInfo in this file: mutation-manifest.test.ts reads a
// test's body only up to the next line starting with `test.`, so `test.setTimeout(…)` as the
// first line would hide the rest of the body from it.
test('sparse users, clinics and requests render leak-free on every console page and can be blocked', async ({ page, factory }, testInfo) => {
  testInfo.setTimeout(90_000)
  const guards = attachErrorGuards(page)
  // A throwaway clinic with no phone or address, one nameless email-less member, and a user who
  // belongs to no clinic at all (the shape the sign-up trigger leaves before approval).
  const clinic = await factory.createClinic()
  expect(clinic).toMatchObject({ phone: null, address: null })
  const mobileOnly = await factory.createAuthUser({ clinicId: clinic.id, email: null, fullName: null })
  const clinicless = await factory.createAuthUser({ clinicId: clinic.id })
  const { error } = await adminClient().from('profiles').update({ clinic_id: null }).eq('id', clinicless.id)
  if (error) throw new Error(`detach profile from its clinic: ${error.message}`)
  const seededMobileOnlyId = await profileIdByMobile(SPARSE_PROFILES.mobileOnly.mobile)
  const seededNamelessId = await profileIdByMobile(SPARSE_PROFILES.nameless.mobile)
  const mobileLabel = formatMobileNumber(mobileOnly.mobileNumber)

  await page.goto('/platform')
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
  await expectNoLeakedNulls(page)

  await page.goto('/platform/users')
  const mobileRow = page.getByTestId(`user-row-${mobileOnly.id}`)
  // No name and no email: the row and its buttons are named by the mobile number, never blank.
  await expect(mobileRow).toContainText(`${mobileLabel} · ${clinic.name}`)
  await expect(page.getByTestId(`user-row-${clinicless.id}`)).toContainText(`${clinicless.email} · No clinic`)
  const seededMobileRow = page.getByTestId(`user-row-${seededMobileOnlyId}`)
  await expect(seededMobileRow).toContainText(SPARSE_PROFILES.mobileOnly.fullName)
  await expect(seededMobileRow).toContainText(formatMobileNumber(SPARSE_PROFILES.mobileOnly.mobile))
  await expect(page.getByTestId(`user-row-${seededNamelessId}`)).toContainText(SPARSE_PROFILES.nameless.email)
  await expectNoLeakedNulls(page)

  await mobileRow.getByRole('button', { name: `Block user ${mobileLabel}`, exact: true }).click()
  await expect(toast(page, 'User blocked')).toBeVisible()
  await expect(mobileRow.getByText('blocked', { exact: true })).toBeVisible()
  await expect.poll(async () => (await factory.findProfileById(mobileOnly.id))?.status).toBe('blocked')
  await expectNoLeakedNulls(page)
  await mobileRow.getByRole('button', { name: `Unblock user ${mobileLabel}`, exact: true }).click()
  await expect(toast(page, 'User unblocked')).toBeVisible()
  await expect.poll(async () => (await factory.findProfileById(mobileOnly.id))?.status).toBe('active')

  await page.goto('/platform/clinics')
  const clinicCard = card(page, clinic.name)
  // One member left and no phone: nothing trails the patient count.
  await expect(clinicCard.getByText('1 user · 0 patients', { exact: true })).toBeVisible()
  await expectNoLeakedNulls(page)
  await clinicCard.getByRole('button', { name: `Block clinic ${clinic.name}`, exact: true }).click()
  await expect(toast(page, 'Clinic blocked')).toBeVisible()
  await expect(clinicCard.getByText('blocked', { exact: true })).toBeVisible()
  await expectNoLeakedNulls(page)
  await clinicCard.getByRole('button', { name: `Unblock clinic ${clinic.name}`, exact: true }).click()
  await expect(toast(page, 'Clinic unblocked')).toBeVisible({ timeout: 15_000 })
  await expect.poll(async () => (await factory.findClinicById(clinic.id))?.status).toBe('active')

  await page.goto('/platform/clinic-requests')
  const sparseRequest = card(page, SPARSE_NAMES.onboardingClinic)
  await expect(sparseRequest).toContainText(SPARSE_NAMES.onboardingOwnerEmail)
  await expect(sparseRequest.getByRole('button', { name: `Approve ${SPARSE_NAMES.onboardingClinic}`, exact: true })).toBeEnabled()
  // Phone and address are NULL, so their line is not rendered at all (no lone separator).
  await expect(sparseRequest.locator('div.text-sm').filter({ hasText: /^\s*·|·\s*$/ })).toHaveCount(0)
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('rejecting with a blank reason stores no reason and the card says Rejected.', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const request = await factory.createOnboardingRequest()

  await page.goto('/platform/clinic-requests')
  const requestCard = card(page, request.clinic_name)
  await expect(requestCard.getByLabel(`Rejection reason for ${request.clinic_name}`, { exact: true })).toHaveValue('')
  await requestCard.getByRole('button', { name: `Reject ${request.clinic_name}`, exact: true }).click()
  await expect(toast(page, 'Request rejected')).toBeVisible()
  await expect(requestCard.getByText('Rejected.', { exact: true })).toBeVisible()
  await expect(requestCard.getByText('rejected', { exact: true })).toBeVisible()
  await expect(requestCard.getByRole('button')).toHaveCount(0)

  expect(await factory.findOnboardingRequestByEmail(request.owner_email)).toMatchObject({
    status: 'rejected',
    rejection_reason: null,
    clinic_id: null,
  })
  expect(await clinicsNamed(request.clinic_name)).toEqual([])
  await expectNoLeakedNulls(page)

  await page.reload()
  await expect(card(page, request.clinic_name).getByText('Rejected.', { exact: true })).toBeVisible()
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('a request approved with no clinic phone or address renders on Requests, Clinics and Users without leaks', async ({ page, factory }, testInfo) => {
  testInfo.setTimeout(60_000)
  const guards = attachErrorGuards(page)
  const request = await factory.createOnboardingRequest()
  const email = request.owner_email
  factory.watchUiOnboardingRequest({ ownerEmail: email, clinicName: request.clinic_name })
  factory.watchUiInvite(email)

  await page.goto('/platform/clinic-requests')
  const requestCard = card(page, request.clinic_name)
  await expect(requestCard).toContainText(`${request.owner_full_name} · ${email} · ${request.owner_mobile_number}`)
  await expectNoLeakedNulls(page)

  await requestCard.getByRole('button', { name: `Approve ${request.clinic_name}`, exact: true }).click()
  await expect(toast(page, 'Clinic approved')).toBeVisible()
  const credentials = page.getByRole('dialog', { name: 'Temporary password issued' })
  await expect(credentials).toBeVisible()
  await expect(credentials.getByTestId('temp-login-mobile')).toHaveText(formatMobileNumber(request.owner_mobile_number))
  await expectNoLeakedNulls(page, { scope: credentials })
  await credentials.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(credentials).toBeHidden()

  await expect(requestCard.getByText('Approved and converted into a clinic.', { exact: true })).toBeVisible()
  await expect(requestCard.getByText('approved', { exact: true })).toBeVisible()
  await expectNoLeakedNulls(page)

  await expect.poll(async () => (await factory.findOnboardingRequestByEmail(email))?.status).toBe('approved')
  const approved = await factory.findOnboardingRequestByEmail(email)
  const clinic = await factory.findClinicById(approved!.clinic_id!)
  expect(clinic).toMatchObject({ name: request.clinic_name, phone: null, address: null, status: 'active' })
  const invite = await factory.findInviteByEmail(email)
  const ownerId = invite!.auth_user_id!
  factory.trackAuthUser(ownerId, email)
  factory.trackProfile(ownerId, email)

  await page.goto('/platform/clinics')
  await expect(card(page, request.clinic_name).getByText('1 user · 0 patients', { exact: true })).toBeVisible()
  await expectNoLeakedNulls(page)

  await page.goto('/platform/users')
  await expect(page.getByTestId(`user-row-${ownerId}`)).toContainText(request.clinic_name)
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('Send reset on an email-less user says it has no email and the button comes back', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id, email: null })
  const label = formatMobileNumber(user.mobileNumber)

  await page.goto('/platform/users')
  const row = page.getByTestId(`user-row-${user.id}`)
  const sendReset = row.getByRole('button', { name: `Send reset for ${label}`, exact: true })
  await sendReset.click()
  // G-9 (fixed with this test): used to answer "User was not found." for a user it had just listed.
  await expect(toast(page, 'Could not send reset link')).toBeVisible()
  await expect(toast(page, 'This user has no email address. Issue a temporary password instead.')).toBeVisible()
  await expect(sendReset).toBeEnabled()
  await expect(sendReset.locator('.animate-spin')).toHaveCount(0)
  expect((await factory.getAuthUser(user.id)).recovery_sent_at).toBeFalsy()
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('Issue temp password for a mobile-only user shows the mobile number to sign in with', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id, email: null, fullName: null })
  const label = formatMobileNumber(user.mobileNumber)

  await page.goto('/platform/users')
  const confirmed = page.waitForEvent('dialog').then(async (dialog) => {
    const message = dialog.message()
    await dialog.accept()
    return message
  })
  await page.getByTestId(`user-row-${user.id}`)
    .getByRole('button', { name: `Issue temp password for ${label}`, exact: true })
    .click()
  // No name and no email: the confirm names the person by their mobile number.
  expect(await confirmed).toBe(`Replace ${label}'s password with a temporary one? Their current password stops working.`)

  const credentials = page.getByRole('dialog', { name: 'Temporary password issued' })
  await expect(credentials.getByTestId('temp-login-mobile')).toHaveText(label)
  await expect(credentials.getByText('Email', { exact: true })).toHaveCount(0)
  expect((await credentials.getByTestId('temp-password').textContent())!.trim().length).toBeGreaterThanOrEqual(8)
  await expectNoLeakedNulls(page, { scope: credentials })
  await credentials.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(credentials).toBeHidden()
  await expect.poll(async () => (await factory.getAuthUser(user.id)).app_metadata?.must_change_password).toBe(true)
  await guards.assertClean()
})

test('Issue temp password asks first for a signed-up user: dismiss changes nothing, accept arms the forced change', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })
  let actionRequests = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.headers()['next-action'] !== undefined) actionRequests += 1
  })

  await page.goto('/platform/users')
  const issue = page.getByTestId(`user-row-${user.id}`)
    .getByRole('button', { name: `Issue temp password for ${user.email}`, exact: true })

  const dismissed = page.waitForEvent('dialog').then(async (dialog) => {
    const message = dialog.message()
    await dialog.dismiss()
    return message
  })
  await issue.click()
  expect(await dismissed).toBe(`Replace ${user.profile.full_name}'s password with a temporary one? Their current password stops working.`)
  await expect(issue).toBeEnabled()
  await expect(issue.locator('.animate-spin')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(actionRequests).toBe(0)
  expect((await factory.getAuthUser(user.id)).app_metadata?.must_change_password).toBeFalsy()
  expect(await passwordWorks(user.email, PASSWORD)).toBe(true)

  page.once('dialog', (dialog) => { void dialog.accept() })
  await issue.click()
  const credentials = page.getByRole('dialog', { name: 'Temporary password issued' })
  await expect(credentials).toBeVisible()
  const tempPassword = (await credentials.getByTestId('temp-password').textContent())!.trim()
  await credentials.getByRole('button', { name: 'Done', exact: true }).click()
  await expect.poll(async () => (await factory.getAuthUser(user.id)).app_metadata?.must_change_password).toBe(true)
  expect(actionRequests).toBe(1)
  expect(tempPassword.length).toBeGreaterThanOrEqual(8)
  expect(await passwordWorks(user.email, PASSWORD)).toBe(false)
  await guards.assertClean()
})

// ============================================================================================
// Failures (PL-6..PL-8)
// ============================================================================================

async function approveExistingOwnerRequest(page: Page, factory: E2EFactory) {
  const clinic = await factory.createClinic()
  const existing = await factory.createAuthUser({ clinicId: clinic.id })
  const request = await factory.createOnboardingRequest({ ownerEmail: existing.email })
  // An orphan clinic, if one is left behind, carries the request's name; teardown finds it by that.
  factory.watchUiOnboardingRequest({ ownerEmail: existing.email, clinicName: request.clinic_name })

  await page.goto('/platform/clinic-requests')
  const requestCard = card(page, request.clinic_name)
  const approve = requestCard.getByRole('button', { name: `Approve ${request.clinic_name}`, exact: true })
  await approve.click()
  await expect(toast(page, 'Approval failed')).toBeVisible()
  await expect(toast(page, 'This email address already belongs to another account.')).toBeVisible()
  return { existing, request, requestCard, approve }
}

test('approving a request whose owner already has a login says why and leaves the request pending', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const { existing, request, requestCard, approve } = await approveExistingOwnerRequest(page, factory)

  await expect(approve).toBeEnabled()
  await expect(approve.locator('.animate-spin')).toHaveCount(0)
  await expect(requestCard.getByRole('button', { name: `Reject ${request.clinic_name}`, exact: true })).toBeEnabled()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await factory.findOnboardingRequestByEmail(existing.email)).toMatchObject({ status: 'pending', clinic_id: null })
  expect(await factory.findInviteByEmail(existing.email)).toBeNull()
  // The existing login is untouched: same clinic, same password.
  expect((await factory.findProfileById(existing.id))?.clinic_id).toBe(existing.profile.clinic_id)
  expect(await passwordWorks(existing.email, PASSWORD)).toBe(true)
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('approving a request whose owner already has a login leaves no orphan clinic (G-5)', async ({ page, factory }) => {
  // G-5: the clinic is inserted before the owner login is created; when that fails the approval
  // removes the clinic again, so no attempt (first or retried) leaves one behind.
  const guards = attachErrorGuards(page)
  const { request, approve } = await approveExistingOwnerRequest(page, factory)
  expect(await clinicsNamed(request.clinic_name)).toEqual([])

  const retry = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.request().headers()['next-action'] !== undefined)
  await approve.click()
  await retry
  await expect(approve).toBeEnabled()
  expect(await clinicsNamed(request.clinic_name)).toEqual([])
  await guards.assertClean()
})

test('a dropped Approve request leaves the request pending and Approve usable', async ({ page, factory }, testInfo) => {
  testInfo.setTimeout(60_000)
  const guards = faultGuards(page)
  const request = await factory.createOnboardingRequest()
  factory.watchUiOnboardingRequest({ ownerEmail: request.owner_email, clinicName: request.clinic_name })
  factory.watchUiInvite(request.owner_email)

  await gotoSettled(page, '/platform/clinic-requests')
  const requestCard = card(page, request.clinic_name)
  const approve = requestCard.getByRole('button', { name: `Approve ${request.clinic_name}`, exact: true })
  const fault = await failNextServerAction(page, 'abort')
  await approve.click()
  await expectAbortRecovered(approve, `Approve ${request.clinic_name}`, fault)
  await expect(toast(page, 'Approval failed')).toBeVisible()
  await expect(requestCard.getByRole('button', { name: `Reject ${request.clinic_name}`, exact: true })).toBeEnabled()
  expect(await factory.findOnboardingRequestByEmail(request.owner_email)).toMatchObject({ status: 'pending', clinic_id: null })
  expect(await clinicsNamed(request.clinic_name)).toEqual([])
  expect(await factory.findInviteByEmail(request.owner_email)).toBeNull()

  await fault.dispose()
  await approve.click()
  await expect(toast(page, 'Clinic approved')).toBeVisible()
  await page.getByRole('dialog', { name: 'Temporary password issued' }).getByRole('button', { name: 'Done', exact: true }).click()
  await expect.poll(async () => (await factory.findOnboardingRequestByEmail(request.owner_email))?.status).toBe('approved')
  expect(await clinicsNamed(request.clinic_name)).toHaveLength(1)
  await trackApprovedOwner(factory, request.owner_email)
  await guards.assertClean()
})

test('a dropped Reject request keeps the typed reason and Reject usable', async ({ page, factory }) => {
  const guards = faultGuards(page)
  const request = await factory.createOnboardingRequest()
  const reason = factory.uniqueName('rejection-reason')

  await gotoSettled(page, '/platform/clinic-requests')
  const requestCard = card(page, request.clinic_name)
  const reasonInput = requestCard.getByLabel(`Rejection reason for ${request.clinic_name}`, { exact: true })
  await reasonInput.fill(reason)
  const reject = requestCard.getByRole('button', { name: `Reject ${request.clinic_name}`, exact: true })
  const fault = await failNextServerAction(page, 'abort')
  await reject.click()
  await expectAbortRecovered(reject, `Reject ${request.clinic_name}`, fault)
  await expect(toast(page, 'Rejection failed')).toBeVisible()
  await expect(reasonInput).toHaveValue(reason)
  expect(await factory.findOnboardingRequestByEmail(request.owner_email)).toMatchObject({ status: 'pending', rejection_reason: null })

  await fault.dispose()
  await reject.click()
  await expect(toast(page, 'Request rejected')).toBeVisible()
  await expect.poll(async () => (await factory.findOnboardingRequestByEmail(request.owner_email))?.rejection_reason).toBe(reason)
  await guards.assertClean()
})

test('a dropped Block clinic request leaves the clinic and its users active', async ({ page, factory }) => {
  const guards = faultGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })

  await gotoSettled(page, '/platform/clinics')
  const block = card(page, clinic.name).getByRole('button', { name: `Block clinic ${clinic.name}`, exact: true })
  const fault = await failNextServerAction(page, 'abort')
  await block.click()
  await expectAbortRecovered(block, `Block clinic ${clinic.name}`, fault)
  await expect(toast(page, 'Action failed')).toBeVisible()
  expect((await factory.findClinicById(clinic.id))?.status).toBe('active')
  expect(isFutureBan((await factory.getAuthUser(user.id)).banned_until)).toBe(false)

  await fault.dispose()
  await block.click()
  await expect(toast(page, 'Clinic blocked')).toBeVisible()
  await expect.poll(async () => (await factory.findClinicById(clinic.id))?.status).toBe('inactive')
  await guards.assertClean()
})

test('a dropped Unblock clinic request leaves the clinic blocked and Unblock usable', async ({ page, factory }) => {
  const guards = faultGuards(page)
  const clinic = await factory.createClinic({ status: 'inactive' })

  await gotoSettled(page, '/platform/clinics')
  const unblock = card(page, clinic.name).getByRole('button', { name: `Unblock clinic ${clinic.name}`, exact: true })
  const fault = await failNextServerAction(page, 'abort')
  await unblock.click()
  await expectAbortRecovered(unblock, `Unblock clinic ${clinic.name}`, fault)
  await expect(toast(page, 'Action failed')).toBeVisible()
  expect((await factory.findClinicById(clinic.id))?.status).toBe('inactive')

  await fault.dispose()
  await unblock.click()
  await expect(toast(page, 'Clinic unblocked')).toBeVisible()
  await expect.poll(async () => (await factory.findClinicById(clinic.id))?.status).toBe('active')
  await guards.assertClean()
})

test('a dropped Block user request leaves the user active and Block usable', async ({ page, factory }) => {
  const guards = faultGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })

  await gotoSettled(page, '/platform/users')
  const block = page.getByTestId(`user-row-${user.id}`).getByRole('button', { name: `Block user ${user.email}`, exact: true })
  const fault = await failNextServerAction(page, 'abort')
  await block.click()
  await expectAbortRecovered(block, `Block user ${user.email}`, fault)
  await expect(toast(page, 'Action failed')).toBeVisible()
  expect((await factory.findProfileById(user.id))?.status).toBe('active')
  expect(isFutureBan((await factory.getAuthUser(user.id)).banned_until)).toBe(false)

  await fault.dispose()
  await block.click()
  await expect(toast(page, 'User blocked')).toBeVisible()
  await expect.poll(async () => (await factory.findProfileById(user.id))?.status).toBe('blocked')
  await guards.assertClean()
})

test('a dropped Unblock user request leaves the user blocked and Unblock usable', async ({ page, factory }) => {
  const guards = faultGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id, status: 'blocked' })

  await gotoSettled(page, '/platform/users')
  const unblock = page.getByTestId(`user-row-${user.id}`).getByRole('button', { name: `Unblock user ${user.email}`, exact: true })
  const fault = await failNextServerAction(page, 'abort')
  await unblock.click()
  await expectAbortRecovered(unblock, `Unblock user ${user.email}`, fault)
  await expect(toast(page, 'Action failed')).toBeVisible()
  expect((await factory.findProfileById(user.id))?.status).toBe('blocked')

  await fault.dispose()
  await unblock.click()
  await expect(toast(page, 'User unblocked')).toBeVisible()
  await expect.poll(async () => (await factory.findProfileById(user.id))?.status).toBe('active')
  await guards.assertClean()
})

test('a dropped Send reset request sends nothing and Send reset stays usable', async ({ page, factory }) => {
  const guards = faultGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })
  const before = (await factory.getAuthUser(user.id)).recovery_sent_at

  await gotoSettled(page, '/platform/users')
  const sendReset = page.getByTestId(`user-row-${user.id}`).getByRole('button', { name: `Send reset for ${user.email}`, exact: true })
  const fault = await failNextServerAction(page, 'abort')
  await sendReset.click()
  await expectAbortRecovered(sendReset, `Send reset for ${user.email}`, fault)
  await expect(toast(page, 'Could not send reset link')).toBeVisible()
  expect((await factory.getAuthUser(user.id)).recovery_sent_at).toBe(before)

  await fault.dispose()
  await sendReset.click()
  await expect(toast(page, 'Reset link sent')).toBeVisible()
  await expect.poll(async () => (await factory.getAuthUser(user.id)).recovery_sent_at).not.toBe(before)
  await guards.assertClean()
})

test('a dropped Issue temp password request keeps the old password and the button usable', async ({ page, factory }) => {
  const guards = faultGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })
  page.on('dialog', (dialog) => { void dialog.accept() })

  await gotoSettled(page, '/platform/users')
  const issue = page.getByTestId(`user-row-${user.id}`).getByRole('button', { name: `Issue temp password for ${user.email}`, exact: true })
  const fault = await failNextServerAction(page, 'abort')
  await issue.click()
  await expectAbortRecovered(issue, `Issue temp password for ${user.email}`, fault)
  await expect(toast(page, 'Could not issue temp password')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Temporary password issued' })).toHaveCount(0)
  expect((await factory.getAuthUser(user.id)).app_metadata?.must_change_password).toBeFalsy()
  expect(await passwordWorks(user.email, PASSWORD)).toBe(true)

  await fault.dispose()
  await issue.click()
  const credentials = page.getByRole('dialog', { name: 'Temporary password issued' })
  await expect(credentials.getByTestId('temp-password')).toBeVisible()
  await credentials.getByRole('button', { name: 'Done', exact: true }).click()
  await expect.poll(async () => (await factory.getAuthUser(user.id)).app_metadata?.must_change_password).toBe(true)
  await guards.assertClean()
})

test('while Approve is in flight on one request, rejecting another keeps the first one locked (G-5)', async ({ page, factory }, testInfo) => {
  // G-5: the list tracks each request's call on its own, so the second click cannot re-enable the
  // first request's Approve and Reject while its approval is still running.
  testInfo.setTimeout(60_000)
  const guards = faultGuards(page)
  const first = await factory.createOnboardingRequest()
  const second = await factory.createOnboardingRequest()
  factory.watchUiOnboardingRequest({ ownerEmail: first.owner_email, clinicName: first.clinic_name })
  factory.watchUiInvite(first.owner_email)

  await gotoSettled(page, '/platform/clinic-requests')
  const firstCard = card(page, first.clinic_name)
  const approveFirst = firstCard.getByRole('button', { name: `Approve ${first.clinic_name}`, exact: true })
  const rejectFirst = firstCard.getByRole('button', { name: `Reject ${first.clinic_name}`, exact: true })
  const hold = await holdNextServerAction(page)
  await approveFirst.click()
  await hold.whenHeld()
  await expect(approveFirst).toBeDisabled()
  await expect(rejectFirst).toBeDisabled()

  await card(page, second.clinic_name).getByRole('button', { name: `Reject ${second.clinic_name}`, exact: true }).click()
  await expect(approveFirst).toBeDisabled({ timeout: 3_000 })
  await expect(rejectFirst).toBeDisabled({ timeout: 3_000 })

  await hold.release()
  await expect(toast(page, 'Clinic approved')).toBeVisible()
  await page.getByRole('dialog', { name: 'Temporary password issued' }).getByRole('button', { name: 'Done', exact: true }).click()
  await expect.poll(async () => (await factory.findOnboardingRequestByEmail(first.owner_email))?.status).toBe('approved')
  await trackApprovedOwner(factory, first.owner_email)
  await expect.poll(async () => (await factory.findOnboardingRequestByEmail(second.owner_email))?.status).toBe('rejected')
  await guards.assertClean()
})
