import type { Browser, Locator, Page } from '@playwright/test'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { useEmailSignIn } from '../support/login'
import { test, expect, type E2EFactory } from '../support/factories'
import { expectFailureMessage } from '../support/fault-injection'
import { isMobileProject } from '../support/mobile'
import { adminClient } from '../support/supabase-admin'

test('submits a representative clinic onboarding request', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const clinicName = factory.uniqueName('public-clinic')
  const ownerName = factory.uniqueName('public-owner')
  const ownerEmail = factory.uniqueEmail('onboarding')
  const ownerMobile = factory.uniqueMobile()
  factory.watchUiOnboardingRequest({ ownerEmail, clinicName })

  await page.goto('/clinic-onboarding')
  await page.getByLabel('Clinic name').fill(clinicName)
  await page.getByLabel('Owner name').fill(ownerName)
  await page.getByLabel('Owner email').fill(ownerEmail)
  await page.getByLabel('Owner mobile').fill(ownerMobile)
  await page.getByLabel('Clinic phone').fill(factory.uniqueMobile())
  await page.getByLabel('Clinic address').fill('E2E public onboarding address')
  await page.getByRole('button', { name: 'Submit Request', exact: true }).click()

  await expect(page.getByText('Your request has been submitted for review.', { exact: false })).toBeVisible()
  await expect.poll(async () => (await factory.findOnboardingRequestByEmail(ownerEmail))?.status).toBe('pending')
  expect(await factory.findOnboardingRequestByEmail(ownerEmail)).toMatchObject({
    clinic_name: clinicName,
    owner_full_name: ownerName,
    owner_mobile_number: ownerMobile,
    clinic_id: null,
  })
  await guards.assertClean()
})

test('shows invalid login and accepts valid credentials for a disposable local user', async ({ page, factory }) => {
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })

  await page.goto('/login')
  // Mobile number is the default sign-in: the 10 digits, spaces allowed.
  await page.getByLabel('Mobile number', { exact: true }).fill(`${user.mobileNumber.slice(0, 5)} ${user.mobileNumber.slice(5)}`)
  await page.getByLabel('Password').fill('incorrect-e2e-password')
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page.getByText('Mobile number or password is incorrect.', { exact: true })).toBeVisible()

  // The negative control intentionally receives a 400 from GoTrue; guard the successful retry.
  const guards = attachErrorGuards(page)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:3000/')
  await guards.assertClean()
})

test('refuses anything but the 10-digit mobile number before calling Auth', async ({ page }) => {
  await page.goto('/login')
  for (const typed of ['12345', '+91 90000 00001', '09000000001']) {
    await page.getByLabel('Mobile number', { exact: true }).fill(typed)
    await page.getByLabel('Password').fill('anything-at-all')
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    await expect(page.getByText('Enter your 10-digit mobile number, without +91 or 0.', { exact: true })).toBeVisible()
  }
  await expect(page).toHaveURL(/\/login/)
})

test('still signs in with email for accounts that have one', async ({ page, factory }) => {
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })

  await page.goto('/login')
  await useEmailSignIn(page)
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password').fill('incorrect-e2e-password')
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page.getByText('Email or password is incorrect.', { exact: true })).toBeVisible()

  const guards = attachErrorGuards(page)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:3000/')
  await guards.assertClean()
})

test('requests a password reset through the real login UI', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })
  const before = (await factory.getAuthUser(user.id)).recovery_sent_at

  await page.goto('/login')
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click()
  await page.getByLabel('Email').fill(user.email)
  await page.getByRole('button', { name: 'Send Reset Link', exact: true }).click()
  await expect(page.getByText('If an account exists for that email, a reset link has been sent.', { exact: true })).toBeVisible()
  await expect.poll(async () => (await factory.getAuthUser(user.id)).recovery_sent_at).not.toBe(before)
  await guards.assertClean()
})

test('completes a real pending invite and signs in with the new password', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const fullName = factory.uniqueName('invitee')
  const mobileNumber = factory.uniqueMobile()
  const clinic = await factory.createClinic()
  const pending = await factory.createInviteAction({ clinicId: clinic.id, fullName, mobileNumber })
  const newPassword = 'E2E-Invite-New-Password-456!'

  await page.goto(pending.actionLink)
  await expect(page).toHaveURL('http://localhost:3000/auth/complete-invite')
  await expect(page.getByText('Complete your account', { exact: true })).toBeVisible()
  await page.getByLabel('Password', { exact: true }).fill(newPassword)
  await page.getByLabel('Confirm password', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: 'Finish Sign-Up', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:3000/login?invite=complete')
  await expect(page.getByText('Your account is ready. Sign in with your new password.', { exact: true })).toBeVisible()

  await expect.poll(async () => (await factory.findInviteByEmail(pending.email))?.status).toBe('accepted')
  expect(await factory.findProfileById(pending.authUserId)).toMatchObject({
    clinic_id: pending.invite.clinic_id,
    email: pending.email,
    full_name: fullName,
    mobile_number: mobileNumber,
    role: 'staff',
  })
  await useEmailSignIn(page)
  await page.getByLabel('Email', { exact: true }).fill(pending.email)
  await page.getByLabel('Password').fill(newPassword)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:3000/')
  await guards.assertClean()
})

test('rejects a weak password on the real invite completion form', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  const pending = await factory.createInviteAction({ clinicId: clinic.id })

  await page.goto(pending.actionLink)
  await expect(page).toHaveURL('http://localhost:3000/auth/complete-invite')
  await expect(
    page.getByText('Use at least 8 characters with an uppercase letter, a lowercase letter, and a number.', { exact: true })
  ).toBeVisible()

  // Long enough, but no uppercase and no digit — the Supabase project minimum would accept it.
  await page.getByLabel('Password', { exact: true }).fill('onlylowercaseletters')
  await page.getByLabel('Confirm password', { exact: true }).fill('onlylowercaseletters')
  await page.getByRole('button', { name: 'Finish Sign-Up', exact: true }).click()

  await expect(page).toHaveURL('http://localhost:3000/auth/complete-invite')
  await expect(
    page.getByText('Use at least 8 characters with an uppercase letter, a lowercase letter, and a number.', { exact: true })
  ).toBeVisible()
  expect(await factory.findInviteByEmail(pending.email)).toMatchObject({ status: 'pending' })
  await guards.assertClean()
})

test('updates a password through a real local recovery action link', async ({ page, context, factory }) => {
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })
  const recovery = await factory.createRecoveryAction(user.email)
  const newPassword = 'E2E-Recovery-New-Password-789!'
  await page.addInitScript(() => window.localStorage.setItem('care-book:guided-tour-seen', 'true'))

  await page.goto(recovery.actionLink)
  await expect(page).toHaveURL('http://localhost:3000/auth/update-password')
  await expect(page.getByText('Reset your password', { exact: true })).toBeVisible()
  await page.getByLabel('New password', { exact: true }).fill(newPassword)
  await page.getByLabel('Confirm password', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: 'Update Password', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:3000/')

  await context.clearCookies()
  await page.goto('/login')
  await useEmailSignIn(page)
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password').fill(newPassword)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:3000/')
  await guards.assertClean()
})

test('changes the password from Settings with current-password verification, no email involved', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })

  await page.goto('/login')
  await page.getByLabel('Mobile number', { exact: true }).fill(user.mobileNumber)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:3000/')

  await page.goto('/settings')
  const isMobile = (page.viewportSize()?.width ?? 1280) < 768
  if (isMobile) {
    await page.getByRole('button', { name: /Your Account.*Profile & logout/i }).click()
  }

  const newPassword = `E2e-${factory.token}-Chang3d`
  await page.getByLabel('Current password', { exact: true }).fill(user.password)
  await page.getByLabel('New password', { exact: true }).fill(newPassword)
  await page.getByLabel('Confirm new password', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: 'Change Password', exact: true }).click()
  await expect(page.getByText('Password changed', { exact: true }).filter({ visible: true })).toBeVisible()

  // The new password signs in through the real login form — proof the change stuck.
  await page.getByRole('button', { name: 'Logout', exact: true }).click()
  await page.waitForURL('**/login**', { timeout: 15_000 })
  await page.getByLabel('Mobile number', { exact: true }).fill(user.mobileNumber)
  await page.getByLabel('Password').fill(newPassword)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:3000/')
  await guards.assertClean()
})

// ---------------------------------------------------------------------------------------------
// Plan 5.4: validation errors (SA-12), sparse and refused clinic requests (SA-14) and dead links
// (SA-15). Every account here is a throwaway factory user.
// ---------------------------------------------------------------------------------------------

const POLICY = 'Use at least 8 characters with an uppercase letter, a lowercase letter, and a number.'

/** The message sits under `input` (inside the same field block) and the input says it is invalid. */
async function expectErrorUnder(input: Locator, message: string, options: { ariaInvalid?: boolean } = {}) {
  const field = input.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " space-y-2 ")][1]')
  await expect(field.getByText(message, { exact: true })).toBeVisible()
  if (options.ariaInvalid ?? true) await expect(input).toHaveAttribute('aria-invalid', 'true')
}

/** Proves a password still signs in, from a separate signed-out context. */
async function expectSignsIn(browser: Browser, mobile: string, password: string, landing: RegExp) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await page.goto('http://localhost:3000/login')
  await page.getByLabel('Mobile number', { exact: true }).fill(mobile)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await page.waitForURL(landing, { timeout: 15_000 })
  await context.close()
}

async function signInHere(page: Page, mobile: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Mobile number', { exact: true }).fill(mobile)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 })
}

/** A throwaway user who still carries a temporary password (must change it on sign-in). */
async function userWithTemporaryPassword(factory: E2EFactory) {
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })
  const { error } = await adminClient().auth.admin.updateUserById(user.id, { app_metadata: { must_change_password: true } })
  if (error) throw new Error(`arm forced password change: ${error.message}`)
  return user
}

test('SA-12: invite completion with mismatched passwords shows the error under Confirm password and keeps the invite pending', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  const pending = await factory.createInviteAction({ clinicId: clinic.id })

  await page.goto(pending.actionLink)
  await expect(page).toHaveURL('http://localhost:3000/auth/complete-invite')
  await page.getByLabel('Password', { exact: true }).fill('E2e-Invite-Pass1')
  await page.getByLabel('Confirm password', { exact: true }).fill('E2e-Invite-Pass2')
  const button = page.getByRole('button', { name: 'Finish Sign-Up', exact: true })
  await button.click()
  await expectErrorUnder(page.getByLabel('Confirm password', { exact: true }), 'Passwords do not match.')
  await expect(page.getByLabel('Confirm password', { exact: true })).toBeFocused()
  await expect(button).toBeEnabled()
  await expect(page).toHaveURL('http://localhost:3000/auth/complete-invite')
  expect(await factory.findInviteByEmail(pending.email)).toMatchObject({ status: 'pending' })
  await guards.assertClean()
})

test('SA-12: the forced password change rejects a weak and a mismatched password under the right field', async ({ page, browser, factory }) => {
  const guards = attachErrorGuards(page)
  const user = await userWithTemporaryPassword(factory)
  await signInHere(page, user.mobileNumber, user.password)
  await expect(page).toHaveURL('http://localhost:3000/auth/change-password')

  const newPassword = page.getByLabel('New password', { exact: true })
  const confirm = page.getByLabel('Confirm new password', { exact: true })
  const button = page.getByRole('button', { name: 'Save New Password', exact: true })
  await newPassword.fill('onlylowercaseletters')
  await confirm.fill('onlylowercaseletters')
  await button.click()
  await expectErrorUnder(newPassword, POLICY)
  await expect(button).toBeEnabled()

  await newPassword.fill('E2e-Forced-Pass1')
  await confirm.fill('E2e-Forced-Pass2')
  await button.click()
  await expectErrorUnder(confirm, 'Passwords do not match.')
  await expect(confirm).toBeFocused()
  await expect(button).toBeEnabled()
  await expect(page).toHaveURL('http://localhost:3000/auth/change-password')

  // Nothing changed: the temporary password still signs in (and still forces the change).
  expect((await factory.getAuthUser(user.id)).app_metadata?.must_change_password).toBe(true)
  await expectSignsIn(browser, user.mobileNumber, user.password, /\/auth\/change-password$/)
  await guards.assertClean()
})

test('SA-12: Update Password with mismatched passwords says so and the old password still works', async ({ page, browser, factory }) => {
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })
  const recovery = await factory.createRecoveryAction(user.email)

  await page.goto(recovery.actionLink)
  await expect(page).toHaveURL('http://localhost:3000/auth/update-password')
  await page.getByLabel('New password', { exact: true }).fill('E2e-Reset-Pass1')
  await page.getByLabel('Confirm password', { exact: true }).fill('E2e-Reset-Pass2')
  const button = page.getByRole('button', { name: 'Update Password', exact: true })
  await button.click()
  // This form reports below the fields, not inside one, and moves focus to the confirmation.
  await expect(page.getByText('Passwords do not match.', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Confirm password', { exact: true })).toBeFocused()
  await expect(button).toBeEnabled()
  await expect(page).toHaveURL('http://localhost:3000/auth/update-password')
  await expectSignsIn(browser, user.mobileNumber, user.password, /localhost:3000\/$/)
  await guards.assertClean()
})

test('SA-12: Settings → Change Password rejects a wrong current, a weak and a mismatched password under the right field', async ({ page, browser, factory }) => {
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })
  await signInHere(page, user.mobileNumber, user.password)
  await page.goto('/settings')
  if (isMobileProject(test.info())) await page.getByRole('button', { name: /Your Account.*Profile & logout/i }).click()

  const current = page.getByLabel('Current password', { exact: true })
  const next = page.getByLabel('New password', { exact: true })
  const confirm = page.getByLabel('Confirm new password', { exact: true })
  const button = page.getByRole('button', { name: /^(Change Password|Changing…)$/ })

  await current.fill('not-the-current-password')
  await next.fill('E2e-Changed-Pass1')
  await confirm.fill('E2e-Changed-Pass1')
  await button.click()
  await expectErrorUnder(current, 'Your current password is incorrect.')
  await expect(button).toBeEnabled()
  await expect(button).toHaveAccessibleName('Change Password')

  await current.fill(user.password)
  await next.fill('onlylowercaseletters')
  await confirm.fill('onlylowercaseletters')
  await button.click()
  await expectErrorUnder(next, POLICY)
  await expect(button).toBeEnabled()

  await next.fill('E2e-Changed-Pass1')
  await confirm.fill('E2e-Changed-Pass2')
  await button.click()
  await expectErrorUnder(confirm, 'Passwords do not match.')
  await expect(button).toBeEnabled()

  await expect(page.getByText('Password changed', { exact: true })).toHaveCount(0)
  await expectSignsIn(browser, user.mobileNumber, user.password, /localhost:3000\/$/)
  await guards.assertClean()
})

async function fillClinicRequest(page: Page, input: { clinicName: string; ownerName: string; ownerEmail: string; ownerMobile: string }) {
  await page.goto('/clinic-onboarding')
  await page.getByLabel('Clinic name').fill(input.clinicName)
  await page.getByLabel('Owner name').fill(input.ownerName)
  await page.getByLabel('Owner email').fill(input.ownerEmail)
  await page.getByLabel('Owner mobile').fill(input.ownerMobile)
}

const SUBMITTED = 'Your request has been submitted for review.'

test('SA-14: a clinic request with clinic phone and address left blank stores both as NULL', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const input = {
    clinicName: factory.uniqueName('sparse-clinic'),
    ownerName: factory.uniqueName('sparse-owner'),
    ownerEmail: factory.uniqueEmail('sparse-onboarding'),
    ownerMobile: factory.uniqueMobile(),
  }
  factory.watchUiOnboardingRequest({ ownerEmail: input.ownerEmail, clinicName: input.clinicName })

  await fillClinicRequest(page, input)
  await page.getByRole('button', { name: 'Submit Request', exact: true }).click()
  await expect(page.getByText(SUBMITTED, { exact: false })).toBeVisible()
  await expectNoLeakedNulls(page)
  await expect.poll(async () => (await factory.findOnboardingRequestByEmail(input.ownerEmail))?.status).toBe('pending')
  expect(await factory.findOnboardingRequestByEmail(input.ownerEmail)).toMatchObject({
    clinic_name: input.clinicName,
    owner_full_name: input.ownerName,
    owner_mobile_number: input.ownerMobile,
    clinic_phone: null,
    clinic_address: null,
    clinic_id: null,
  })
  await guards.assertClean()
})

test('SA-14: a duplicate pending request and a fourth request inside the window are refused with their own messages', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const input = {
    clinicName: factory.uniqueName('throttle-clinic'),
    ownerName: factory.uniqueName('throttle-owner'),
    ownerEmail: factory.uniqueEmail('throttle-onboarding'),
    ownerMobile: factory.uniqueMobile(),
  }
  const otherClinic = factory.uniqueName('throttle-clinic-other')
  factory.watchUiOnboardingRequest({ ownerEmail: input.ownerEmail, clinicName: input.clinicName })
  factory.watchUiOnboardingRequest({ ownerEmail: input.ownerEmail, clinicName: otherClinic })
  const button = page.getByRole('button', { name: /^(Submit Request|Submitting…)$/ })
  const rows = async () => {
    const { data, error } = await adminClient().from('clinic_onboarding_requests').select('id, status, clinic_name').eq('owner_email', input.ownerEmail)
    if (error) throw new Error(`onboarding rows: ${error.message}`)
    return data ?? []
  }
  // Platform review takes the request out of "pending" without deleting it.
  const reject = async () => {
    const { error } = await adminClient().from('clinic_onboarding_requests')
      .update({ status: 'rejected' }).eq('owner_email', input.ownerEmail).eq('status', 'pending')
    if (error) throw new Error(`reject onboarding request: ${error.message}`)
  }

  await fillClinicRequest(page, input)
  await button.click()
  await expect(page.getByText(SUBMITTED, { exact: false })).toBeVisible()

  // Same owner email, different clinic, while the first is pending.
  await fillClinicRequest(page, { ...input, clinicName: otherClinic })
  await button.click()
  await expectFailureMessage(page, 'A pending onboarding request already exists for these details.')
  await expect(button).toBeEnabled()
  await expect(button).toHaveAccessibleName('Submit Request')
  expect(await rows()).toHaveLength(1)

  // The same details twice more after each review, then a fourth time inside 30 minutes.
  for (let submitted = 1; submitted < 3; submitted += 1) {
    await reject()
    await fillClinicRequest(page, input)
    await button.click()
    await expect(page.getByText(SUBMITTED, { exact: false })).toBeVisible()
  }
  await reject()
  await fillClinicRequest(page, input)
  await button.click()
  await expectFailureMessage(page, 'Too many onboarding requests were submitted recently. Try again later.')
  await expect(button).toBeEnabled()
  await expect(button).toHaveAccessibleName('Submit Request')
  expect(await rows()).toHaveLength(3)
  expect((await rows()).filter((row) => row.status === 'pending')).toEqual([])
  await guards.assertClean()
})

test('SA-15: the link of a revoked invite lands on sign-in with the invite-link message', async ({ page, factory }, testInfo) => {
  testInfo.skip(!isMobileProject(testInfo), 'phone-only (Pub-M)')
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  const pending = await factory.createInviteAction({ clinicId: clinic.id })
  // What Settings → Revoke does (revokeUserInvite + closeRevokedInviteeAccount): the invite is
  // revoked, the profile loses its clinic, and the account is banned.
  const db = adminClient()
  const now = new Date().toISOString()
  const revoked = await db.from('user_invites').update({ status: 'revoked', revoked_at: now, updated_at: now }).eq('id', pending.invite.id)
  if (revoked.error) throw new Error(`revoke invite: ${revoked.error.message}`)
  const profile = await db.from('profiles').update({ clinic_id: null, role: 'staff' }).eq('id', pending.authUserId)
  if (profile.error) throw new Error(`close invitee profile: ${profile.error.message}`)
  const ban = await db.auth.admin.updateUserById(pending.authUserId, { ban_duration: '876000h' })
  if (ban.error) throw new Error(`ban invitee: ${ban.error.message}`)

  await page.goto(pending.actionLink)
  await expect.poll(() => new URL(page.url()).pathname).toBe('/login')
  expect(new URL(page.url()).searchParams.get('error')).toBe('invite-link-invalid')
  await expect(page.getByText('That invite link is invalid or has expired. Ask an admin to resend it.', { exact: true })).toBeVisible()
  await guards.assertClean()
})

test('SA-15: the link of an invite that was already accepted lands on sign-in with the invite-link message', async ({ page, context, factory }, testInfo) => {
  testInfo.skip(!isMobileProject(testInfo), 'phone-only (Pub-M)')
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  const pending = await factory.createInviteAction({ clinicId: clinic.id })
  await page.goto(pending.actionLink)
  await expect(page).toHaveURL('http://localhost:3000/auth/complete-invite')
  await page.getByLabel('Password', { exact: true }).fill('E2E-Invite-Accepted-1')
  await page.getByLabel('Confirm password', { exact: true }).fill('E2E-Invite-Accepted-1')
  await page.getByRole('button', { name: 'Finish Sign-Up', exact: true }).tap()
  await expect(page).toHaveURL('http://localhost:3000/login?invite=complete')
  await expect.poll(async () => (await factory.findInviteByEmail(pending.email))?.status).toBe('accepted')

  // The same link again, as someone tapping an old message would.
  await context.clearCookies()
  await page.goto(pending.actionLink)
  await expect.poll(() => new URL(page.url()).pathname).toBe('/login')
  expect(new URL(page.url()).searchParams.get('error')).toBe('invite-link-invalid')
  await expect(page.getByText('That invite link is invalid or has expired. Ask an admin to resend it.', { exact: true })).toBeVisible()
  await guards.assertClean()
})

test('SA-15: a recovery link that was already used lands on sign-in with the reset-link message', async ({ page, context, factory }, testInfo) => {
  testInfo.skip(!isMobileProject(testInfo), 'phone-only (Pub-M)')
  const guards = attachErrorGuards(page)
  const clinic = await factory.createClinic()
  const user = await factory.createAuthUser({ clinicId: clinic.id })
  const recovery = await factory.createRecoveryAction(user.email)
  await page.goto(recovery.actionLink)
  await expect(page).toHaveURL('http://localhost:3000/auth/update-password')

  await context.clearCookies()
  await page.goto(recovery.actionLink)
  await expect.poll(() => new URL(page.url()).pathname).toBe('/login')
  expect(new URL(page.url()).searchParams.get('error')).toBe('reset-link-invalid')
  await expect(page.getByText('That reset link is invalid or has expired. Request a new one.', { exact: true })).toBeVisible()
  await guards.assertClean()
})
