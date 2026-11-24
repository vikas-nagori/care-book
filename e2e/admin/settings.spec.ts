import type { Browser, Page } from '@playwright/test'
import { SettingsView, formatMobile } from '../pages/settings-view'
import { CLINIC_A } from '../support/accounts'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { test, expect, type E2EFactory } from '../support/factories'
import { expectFailureMessage } from '../support/fault-injection'
import { isMobileProject, stubShare } from '../support/mobile'
import { assertResponsiveClinicNavigation } from '../support/nav'
import { TEMPORARY_STAFF_PHONE_NOT_MOBILE_MESSAGE } from '../../src/lib/auth/mobile-number'

function stablePhone(token: string): string {
  let hash = 0
  for (const character of token) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return `9${String(hash).padStart(9, '0').slice(-9)}`
}

test('creates, edits, and deletes an appointment type', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const initialName = factory.uniqueName('appointment-type')
  const editedName = factory.uniqueName('appointment-type-edited')
  factory.watchUiAppointmentType(initialName)
  factory.watchUiAppointmentType(editedName)

  await page.goto('/settings')
  const settings = new SettingsView(page)
  await settings.addAppointmentType({ name: initialName, rate: '925' })
  await expect(page.getByText(initialName, { exact: true }).filter({ visible: true })).toBeVisible()
  const created = await factory.findAppointmentTypeByName(initialName)
  expect(created).toMatchObject({ name: initialName, session_rate: 925, is_shared: true })

  await settings.editAppointmentType(initialName, { name: editedName, rate: '1075' })
  await expect(page.getByText(editedName, { exact: true }).filter({ visible: true })).toBeVisible()
  const edited = await factory.findAppointmentTypeByName(editedName)
  expect(edited).toMatchObject({ id: created!.id, session_rate: 1075, is_shared: true })

  await settings.deleteAppointmentType(editedName)
  await expect(page.getByText(editedName, { exact: true })).toHaveCount(0)
  expect(await factory.findAppointmentTypeByName(editedName)).toBeNull()
  await guards.assertClean()
})

test('updates clinic and home-visit fees and restores the singleton setting', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const original = await factory.getGlobalSettings()
  const clinicFee = original.clinic_fee === 845 ? 846 : 845
  const homeVisitFee = original.home_visit_fee === 1145 ? 1146 : 1145

  try {
    await page.goto('/settings')
    const settings = new SettingsView(page)
    await settings.updateSessionFees({
      clinicFee: String(clinicFee),
      homeVisitFee: String(homeVisitFee),
    })

    await expect.poll(() => factory.getGlobalSettings()).toMatchObject({
      id: original.id,
      clinic_id: original.clinic_id,
      clinic_fee: clinicFee,
      home_visit_fee: homeVisitFee,
    })
    await guards.assertClean()
  } finally {
    await factory.restoreGlobalSettings(original)
  }
})

test('creates, edits, and deletes a package template', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const initialName = factory.uniqueName('package-template')
  const editedName = factory.uniqueName('package-template-edited')
  factory.watchUiPackageTemplate(initialName)
  factory.watchUiPackageTemplate(editedName)

  await page.goto('/settings')
  const settings = new SettingsView(page)
  await settings.addPackageTemplate({ name: initialName, sessions: '7', rate: '680' })
  const created = await factory.findPackageTemplateByName(initialName)
  expect(created).toMatchObject({ name: initialName, min_sessions: 7, per_session_amount: 680 })

  await settings.editPackageTemplate(initialName, { name: editedName, sessions: '9', rate: '710' })
  const edited = await factory.findPackageTemplateByName(editedName)
  expect(edited).toMatchObject({ id: created!.id, min_sessions: 9, per_session_amount: 710 })

  await settings.deletePackageTemplate(editedName)
  await expect(page.getByText(editedName, { exact: true })).toHaveCount(0)
  expect(await factory.findPackageTemplateByName(editedName)).toBeNull()
  await guards.assertClean()
})

test('creates temporary staff without sending an invite', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('external-staff')
  const phone = stablePhone(name)
  const email = `${factory.token}-external@carebook.test`
  factory.watchUiExternalStaff({ name, phone })

  await page.goto('/settings')
  const settings = new SettingsView(page)
  await settings.addExternalStaff({ name, phone, email })
  await expect(page.getByText(name, { exact: true }).filter({ visible: true })).toBeVisible()
  const row = await factory.findExternalStaff({ name, phone })
  expect(row).toMatchObject({ email, status: 'active' })
  await guards.assertClean()
})

async function signInAs(browser: Browser, mobileNumber: string, password: string, options: { skipTour?: boolean } = {}) {
  // `browser.newContext()` inherits the project's storageState (the admin session), so the
  // invitee's context must start explicitly signed out.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  // A first sign-in opens the guided tour, a modal that hides the app from assistive tech.
  if (options.skipTour) await page.addInitScript(() => window.localStorage.setItem('care-book:guided-tour-seen', 'true'))
  await page.goto('http://localhost:3000/login')
  // Invitees sign in with the mobile number the admin entered — the login the invite creates.
  await page.getByLabel('Mobile number', { exact: true }).fill(mobileNumber)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  return { context, page }
}

test('invites a user with a temp password, re-issues it, revokes it, and re-invites', async ({ page, browser, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('invited-staff')
  const phone = stablePhone(name)
  const email = `${factory.token}-invite@carebook.test`
  factory.watchUiInvite(email)

  await page.goto('/settings')
  const settings = new SettingsView(page)
  const firstPassword = await settings.inviteUser({ name, phone, email })
  let invite = await factory.findInviteByEmail(email)
  expect(invite).toMatchObject({
    email,
    role: 'staff',
    status: 'pending',
    // Acceptance reads the profile's name and mobile from here, so the password screen never
    // has to re-ask for them.
    full_name: name,
    mobile_number: phone,
  })
  expect(invite!.auth_user_id).not.toBeNull()
  const authUserId = invite!.auth_user_id!

  // No invite email: the account is born confirmed with the forced-change flag armed.
  const authUser = await factory.getAuthUser(authUserId)
  expect(authUser.email_confirmed_at).toBeTruthy()
  expect(authUser.app_metadata?.must_change_password).toBe(true)

  // The invited user's profile must already belong to the inviting admin's clinic with the
  // granted role — the on_auth_user_created trigger only writes a clinic-less placeholder.
  // No trackProfile here: watchUiInvite already reclaims this identity during teardown, and it
  // marks the auth user as disposable before deleting, which a tracked profile row would not.
  const invitedProfile = await factory.findProfileById(authUserId)
  expect(invitedProfile).toMatchObject({ role: 'staff', clinic_id: CLINIC_A.id })

  const secondPassword = await settings.issueNewTempPassword(email)
  expect(secondPassword).not.toBe(firstPassword)
  invite = await factory.findInviteByEmail(email)
  expect(invite).toMatchObject({ status: 'pending', auth_user_id: authUserId })

  await settings.revokeInvite(email)
  // Scoped to this invite's card / row: the seed also keeps a revoked invite (SEED.inviteRevoked).
  await expect(page.locator('section, tr').filter({ hasText: email })
    .getByText('revoked', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect.poll(async () => (await factory.findInviteByEmail(email))?.status).toBe('revoked')

  // Revoking closes the account: no clinic, and sign-in is refused even with the live password.
  expect(await factory.findProfileById(authUserId)).toMatchObject({ clinic_id: null, role: 'staff' })
  const revoked = await signInAs(browser, phone, secondPassword)
  await expect(revoked.page.locator('p.text-destructive')).toBeVisible({ timeout: 15_000 })
  expect(new URL(revoked.page.url()).pathname).toBe('/login')
  await revoked.context.close()

  // The invitee's auth identity already exists, so re-inviting must take the reuse-revoked-invite
  // path, re-arm the same account, and lift the ban.
  const reinvitePassword = await settings.inviteUser({ name, phone, email })
  await expect.poll(async () => (await factory.findInviteByEmail(email))?.status).toBe('pending')
  expect((await factory.findInviteByEmail(email))?.auth_user_id).toBe(authUserId)
  expect(await factory.findProfileById(authUserId)).toMatchObject({ clinic_id: CLINIC_A.id, role: 'staff' })
  const reinvited = await signInAs(browser, phone, reinvitePassword)
  await reinvited.page.waitForURL('**/auth/change-password', { timeout: 15_000 })
  await reinvited.context.close()
  await guards.assertClean()
})

test('an invited user signs in with the temp password and must set their own', async ({ page, browser, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('first-login-staff')
  const phone = stablePhone(name)
  const email = `${factory.token}-first-login@carebook.test`
  factory.watchUiInvite(email)

  await page.goto('/settings')
  const settings = new SettingsView(page)
  const tempPassword = await settings.inviteUser({ name, phone, email })
  const authUserId = (await factory.findInviteByEmail(email))!.auth_user_id!

  // Middleware forces the change page before anything else.
  const invitee = await signInAs(browser, phone, tempPassword)
  const inviteeGuards = attachErrorGuards(invitee.page)
  await invitee.page.waitForURL('**/auth/change-password', { timeout: 15_000 })

  const newPassword = `E2e-${factory.token}-Inv1te`
  await invitee.page.getByLabel('New password', { exact: true }).fill(newPassword)
  await invitee.page.getByLabel('Confirm new password', { exact: true }).fill(newPassword)
  // Submit with Enter: success replaces the route while the button is disabled, which strands a
  // pointer click's actionability loop.
  await invitee.page.getByLabel('Confirm new password', { exact: true }).press('Enter')
  await invitee.page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 })
  await inviteeGuards.assertClean()
  await invitee.context.close()

  // First password change doubles as invite acceptance.
  await expect.poll(async () => (await factory.getAuthUser(authUserId)).app_metadata?.must_change_password).toBe(false)
  await expect.poll(async () => (await factory.findInviteByEmail(email))?.status).toBe('accepted')
  expect(await factory.findProfileById(authUserId)).toMatchObject({
    role: 'staff',
    clinic_id: CLINIC_A.id,
    full_name: name,
    mobile_number: phone,
  })
  await guards.assertClean()
})

// Production incident 2026-11-24: an External Staff invited by mobile number only (no email)
// made /settings throw on every render, locking admins out of the whole settings section.
test('settings still renders with a pending mobile-only invite', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const fullName = factory.uniqueName('mobile-only-external')
  const mobileNumber = stablePhone(fullName)
  await factory.createUserInvite({
    clinicId: CLINIC_A.id,
    email: null,
    role: 'external_staff',
    fullName,
    mobileNumber,
  })

  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  const settings = new SettingsView(page)
  await settings.openSection('Invites')
  // With no email, the invite is labelled by its formatted mobile number.
  const label = `${mobileNumber.slice(0, 5)} ${mobileNumber.slice(5)}`
  await expect(
    page.getByRole('button', { name: `Revoke invite to ${label}`, exact: true }).filter({ visible: true }),
  ).toBeVisible()
  await guards.assertClean()
})

// Email is optional since mobile-number sign-in. Incident 2026-11-24: inviting External Staff with
// no email broke /settings, and the invitee's first sign-in would have looped between
// /auth/change-password and /login (the page required an email). Drive the whole lifecycle blank.
test('invites External Staff by mobile number only, and they can sign in and set a password', async ({ page, browser, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('mobile-only-invitee')
  const phone = stablePhone(name)
  const account = `${phone.slice(0, 5)} ${phone.slice(5)}`
  factory.watchUiMobileInvite(phone)

  await page.goto('/settings')
  const settings = new SettingsView(page)
  await settings.inviteUser({ name, phone, role: 'External Staff' })
  const invite = await factory.findInviteByMobile(phone)
  expect(invite).toMatchObject({ email: null, role: 'external_staff', status: 'pending', full_name: name })
  expect(invite!.auth_user_id).not.toBeNull()
  const authUserId = invite!.auth_user_id!

  // Settings must still render with the email-less invite and profile in it.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  const tempPassword = await settings.issueNewTempPassword(account)

  const invitee = await signInAs(browser, phone, tempPassword)
  const inviteeGuards = attachErrorGuards(invitee.page)
  await invitee.page.waitForURL('**/auth/change-password', { timeout: 15_000 })
  await expect(invitee.page.getByText(account, { exact: true })).toBeVisible()

  const newPassword = `E2e-${factory.token}-M0bile`
  await invitee.page.getByLabel('New password', { exact: true }).fill(newPassword)
  await invitee.page.getByLabel('Confirm new password', { exact: true }).fill(newPassword)
  await invitee.page.getByLabel('Confirm new password', { exact: true }).press('Enter')
  await invitee.page.waitForURL(
    (url) => !url.pathname.startsWith('/auth/') && !url.pathname.startsWith('/login'),
    { timeout: 15_000 },
  )
  await inviteeGuards.assertClean()
  await invitee.context.close()

  await expect.poll(async () => (await factory.findInviteByMobile(phone))?.status).toBe('accepted')
  expect(await factory.findProfileById(authUserId)).toMatchObject({
    role: 'external_staff',
    clinic_id: CLINIC_A.id,
    full_name: name,
    mobile_number: phone,
    email: null,
  })

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await guards.assertClean()
})

// Prod 2026-11-24: after revoking a mobile-only External Staff invite, "Create Login" for the same
// number hung on "Creating..." and never produced a password.
test('re-invites a revoked mobile-only External Staff with the same number', async ({ page, browser, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('reinvite-mobile-only')
  const phone = stablePhone(name)
  const account = `${phone.slice(0, 5)} ${phone.slice(5)}`
  factory.watchUiMobileInvite(phone)

  await page.goto('/settings')
  const settings = new SettingsView(page)
  await settings.inviteUser({ name, phone, role: 'External Staff' })
  const authUserId = (await factory.findInviteByMobile(phone))!.auth_user_id!

  await settings.revokeInvite(account)
  await expect.poll(async () => (await factory.findInviteByMobile(phone))?.status).toBe('revoked')

  const reinvitePassword = await settings.inviteUser({ name, phone, role: 'External Staff' })
  await expect.poll(async () => (await factory.findInviteByMobile(phone))?.status).toBe('pending')
  expect(await factory.findInviteByMobile(phone)).toMatchObject({ auth_user_id: authUserId, role: 'external_staff', email: null })
  expect(await factory.findProfileById(authUserId)).toMatchObject({ clinic_id: CLINIC_A.id, role: 'external_staff' })

  const reinvited = await signInAs(browser, phone, reinvitePassword)
  await reinvited.page.waitForURL('**/auth/change-password', { timeout: 15_000 })
  await reinvited.context.close()
  await guards.assertClean()
})

// Patients can be shared with External Staff before they first sign in, so their patients are
// waiting for them. The pending invitee has no email and no profile name yet (it is copied from
// the invite on acceptance); the patient's access picker must still list them, by name.
test('shares a patient with a pending External Staff invitee, who sees it after first sign-in', async ({ page, browser, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('pending-share')
  const phone = stablePhone(name)
  factory.watchUiMobileInvite(phone)
  const patient = await factory.createPatient()

  await page.goto('/settings')
  const settings = new SettingsView(page)
  const tempPassword = await settings.inviteUser({ name, phone, role: 'External Staff' })
  expect(await factory.findInviteByMobile(phone)).toMatchObject({ status: 'pending' })

  await page.goto(`/patients/${patient.id}`)
  const invitee = page.getByRole('checkbox', { name: new RegExp(name) })
  await expect(invitee).toBeVisible()
  await expect(page.getByText('Invite pending', { exact: true }).filter({ visible: true })).toBeVisible()
  await invitee.check()
  await page.getByRole('button', { name: 'Save access', exact: true }).click()
  await expect(page.getByText('Access saved.', { exact: true })).toBeVisible()

  const external = await signInAs(browser, phone, tempPassword)
  await external.page.waitForURL('**/auth/change-password', { timeout: 15_000 })
  const newPassword = `E2e-${factory.token}-Sh4re`
  await external.page.getByLabel('New password', { exact: true }).fill(newPassword)
  await external.page.getByLabel('Confirm new password', { exact: true }).fill(newPassword)
  await external.page.getByLabel('Confirm new password', { exact: true }).press('Enter')
  await external.page.waitForURL((url) => !url.pathname.startsWith('/auth/'), { timeout: 15_000 })
  await external.page.goto('/external/patients')
  await expect(external.page.getByRole('button', { name: new RegExp(patient.name as string) }).filter({ visible: true })).toBeVisible()
  await external.context.close()
  await guards.assertClean()
})

// ---------------------------------------------------------------------------------------------
// Plan 5.4 (settings and auth). Every account whose password or session changes here is a
// throwaway factory user signed in on its own browser context: Logout revokes *every* session of
// the user (Supabase's default global scope), so the seeded shared sessions are never used for it.
// ---------------------------------------------------------------------------------------------

/** First sign-in with a temporary password: the forced change page, then the app. */
async function completeFirstLogin(page: Page, newPassword: string) {
  await page.waitForURL('**/auth/change-password', { timeout: 15_000 })
  await page.getByLabel('New password', { exact: true }).fill(newPassword)
  await page.getByLabel('Confirm new password', { exact: true }).fill(newPassword)
  // Enter, not a click: success replaces the route while the button is disabled.
  await page.getByLabel('Confirm new password', { exact: true }).press('Enter')
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/') && !url.pathname.startsWith('/login'), { timeout: 15_000 })
}

test('SA-5: Temporary Staff → Create login needs an email, links the invite, and shows onboarded after first login', async ({ page, browser, factory }) => {
  const guards = attachErrorGuards(page)
  const staff = await factory.createExternalStaff()
  const email = factory.uniqueEmail('temp-login')
  factory.watchUiInvite(email)

  await page.goto('/settings')
  const settings = new SettingsView(page)

  // Blank email: refused before any request, button usable, no invite.
  const button = await settings.createLoginForTemporaryStaff(staff.name)
  await expectFailureMessage(page, 'Enter an email address before creating a login.')
  await expect(button).toBeEnabled()
  await expect(button).toHaveAccessibleName('Create login')
  expect(await factory.findInviteByMobile(staff.phone)).toBeNull()

  // A valid email creates the login, linked to this Temporary Staff row.
  await settings.createLoginForTemporaryStaff(staff.name, { email })
  const tempPassword = await settings.takeTempPassword()
  const invite = await factory.findInviteByEmail(email)
  expect(invite).toMatchObject({
    email,
    role: 'staff',
    status: 'pending',
    external_staff_id: staff.id,
    full_name: staff.name,
    mobile_number: staff.phone,
  })
  expect(invite!.auth_user_id).not.toBeNull()
  await settings.openSection('Temporary Staff')
  await expect(settings.temporaryStaffRow(staff.name).getByText('invite pending', { exact: true })).toBeVisible()
  await expect(settings.createLoginForTemporaryStaffButton(staff.name)).toHaveCount(0)

  // First sign-in with the temporary password onboards the Temporary Staff row.
  const invitee = await signInAs(browser, staff.phone, tempPassword)
  const inviteeGuards = attachErrorGuards(invitee.page)
  await completeFirstLogin(invitee.page, `E2e-${factory.token}-T3mp`)
  await inviteeGuards.assertClean()
  await invitee.context.close()

  await expect.poll(async () => (await factory.findExternalStaff({ name: staff.name, phone: staff.phone }))?.status).toBe('onboarded')
  expect(await factory.findExternalStaff({ name: staff.name, phone: staff.phone })).toMatchObject({ linked_profile_id: invite!.auth_user_id })
  await page.reload()
  await settings.openSection('Temporary Staff')
  const row = settings.temporaryStaffRow(staff.name)
  await expect(row.getByText('onboarded', { exact: true })).toBeVisible()
  await expect(row.getByText('Linked to user', { exact: true })).toBeVisible()
  await expectNoLeakedNulls(page, { scope: settings.sectionScope('Temporary Staff') })
  await guards.assertClean()
})

test('SA-5: Temporary Staff whose phone is not a mobile number → Create login re-enables and says why', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const staff = await factory.createExternalStaff({ phone: '022 2345 6789' })
  const email = factory.uniqueEmail('temp-login-landline')
  factory.watchUiInvite(email)

  await page.goto('/settings')
  const settings = new SettingsView(page)
  const button = await settings.createLoginForTemporaryStaff(staff.name, { email })
  await expectFailureMessage(page, TEMPORARY_STAFF_PHONE_NOT_MOBILE_MESSAGE)
  await expect(button).toBeEnabled()
  await expect(button).toHaveAccessibleName('Create login')
  expect(await factory.findInviteByEmail(email)).toBeNull()
  await guards.assertClean()
})

// G-8: a Temporary Staff phone stored as `+91 98765 43210` (there is no field to edit it) used to
// dead-end Create login with "Enter your 10-digit mobile number". The login now takes the 10 digits
// out of the stored phone, and the invitee signs in with them.
test('G-8 SA-5: Temporary Staff with a +91-formatted phone can still be given a login', async ({ page, browser, factory }) => {
  const guards = attachErrorGuards(page)
  const mobile = factory.uniqueMobile()
  const staff = await factory.createExternalStaff({ phone: `+91 ${formatMobile(mobile)}` })
  const email = factory.uniqueEmail('temp-login-g8')
  factory.watchUiInvite(email)
  factory.watchUiMobileInvite(mobile)

  await page.goto('/settings')
  const settings = new SettingsView(page)
  await settings.createLoginForTemporaryStaff(staff.name, { email })
  const tempPassword = await settings.takeTempPassword()
  expect(await factory.findInviteByEmail(email)).toMatchObject({ mobile_number: mobile, external_staff_id: staff.id })

  // The 10 digits really are the login.
  const invitee = await signInAs(browser, mobile, tempPassword)
  await invitee.page.waitForURL('**/auth/change-password', { timeout: 15_000 })
  await invitee.context.close()
  await guards.assertClean()
})

test('SA-6: an Admin invited by mobile only signs in, sets a password and gets the admin workspace', async ({ page, browser, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('mobile-only-admin')
  const phone = factory.uniqueMobile()
  factory.watchUiMobileInvite(phone)

  await page.goto('/settings')
  const settings = new SettingsView(page)
  const tempPassword = await settings.inviteUser({ name, phone, role: 'Admin' })
  const invite = await factory.findInviteByMobile(phone)
  expect(invite).toMatchObject({ email: null, role: 'admin', status: 'pending', full_name: name })

  const invitee = await signInAs(browser, phone, tempPassword, { skipTour: true })
  const inviteeGuards = attachErrorGuards(invitee.page)
  await completeFirstLogin(invitee.page, `E2e-${factory.token}-Adm1n`)
  await expect(invitee.page).toHaveURL('http://localhost:3000/')
  await assertResponsiveClinicNavigation(invitee.page, 'admin')
  await expectNoLeakedNulls(invitee.page)
  await inviteeGuards.assertClean()
  await invitee.context.close()

  await expect.poll(async () => (await factory.findInviteByMobile(phone))?.status).toBe('accepted')
  expect(await factory.findProfileById(invite!.auth_user_id!)).toMatchObject({
    role: 'admin', clinic_id: CLINIC_A.id, email: null, full_name: name, mobile_number: phone,
  })
  await guards.assertClean()
})

test('SA-7: Copy login details puts the mobile number and password on the clipboard', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const name = factory.uniqueName('copy-login')
  const phone = factory.uniqueMobile()
  factory.watchUiMobileInvite(phone)

  await page.goto('/settings')
  const settings = new SettingsView(page)
  await settings.submitInvite({ name, phone })
  const password = await settings.takeTempPassword({ keepOpen: true })
  const dialog = settings.tempPasswordDialog()
  await dialog.getByRole('button', { name: 'Copy login details', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('Login details copied — paste them into WhatsApp or a text message.')
  await expect(dialog.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
  const clipboard = await page.evaluate(() => navigator.clipboard.readText())
  expect(clipboard).toContain(`Mobile number: ${formatMobile(phone)}`)
  expect(clipboard).toContain(`Temporary password: ${password}`)
  expect(clipboard).toContain('http://localhost:3000/login')
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toBeHidden()
  await guards.assertClean()
})

test('SA-7: on a phone the login details go out through the share sheet', async ({ page, factory }, testInfo) => {
  testInfo.skip(!isMobileProject(testInfo), 'the native share sheet is the phone hand-over')
  const guards = attachErrorGuards(page)
  const share = await stubShare(page)
  const name = factory.uniqueName('share-login')
  const phone = factory.uniqueMobile()
  factory.watchUiMobileInvite(phone)

  await page.goto('/settings')
  const settings = new SettingsView(page)
  await settings.submitInvite({ name, phone })
  const password = await settings.takeTempPassword({ keepOpen: true })
  const dialog = settings.tempPasswordDialog()
  await dialog.getByRole('button', { name: 'Share login', exact: true }).tap()
  await expect(dialog.getByRole('status')).toHaveText('Login details shared.')
  const calls = await share.calls()
  expect(calls).toHaveLength(1)
  expect(calls[0].title).toBe('Care-Book login')
  expect(calls[0].text).toContain(`Mobile number: ${formatMobile(phone)}`)
  expect(calls[0].text).toContain(`Temporary password: ${password}`)
  await dialog.getByRole('button', { name: 'Done', exact: true }).tap()
  await expect(dialog).toBeHidden()
  await guards.assertClean()
})

test('SA-7: on a phone a dismissed share sheet is not an error and the details can still be copied', async ({ page, factory }, testInfo) => {
  testInfo.skip(!isMobileProject(testInfo), 'the native share sheet is the phone hand-over')
  const guards = attachErrorGuards(page)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const share = await stubShare(page, { reject: true })
  const name = factory.uniqueName('share-dismissed')
  const phone = factory.uniqueMobile()
  factory.watchUiMobileInvite(phone)

  await page.goto('/settings')
  const settings = new SettingsView(page)
  await settings.submitInvite({ name, phone })
  const password = await settings.takeTempPassword({ keepOpen: true })
  const dialog = settings.tempPasswordDialog()
  await dialog.getByRole('button', { name: 'Share login', exact: true }).tap()
  await expect.poll(async () => (await share.calls()).length).toBe(1)
  // Dismissing the sheet is a choice, not a failure: no error, no "shared", the sheet stays usable.
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog.getByRole('status')).toHaveCount(0)
  await expect(page.getByRole('region', { name: /^Notifications/ }).locator('li').filter({ hasText: /fail|error|wrong|couldn/i })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Copy login details', exact: true }).tap()
  await expect(dialog.getByRole('status')).toHaveText('Login details copied — paste them into WhatsApp or a text message.')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`Temporary password: ${password}`)
  await guards.assertClean()
})

async function logoutFromSettingsAs(browser: Browser, factory: E2EFactory, role: 'admin' | 'staff') {
  const user = await factory.createAuthUser({ clinicId: CLINIC_A.id, role })
  const session = await signInAs(browser, user.mobileNumber, user.password)
  const guards = attachErrorGuards(session.page)
  await session.page.waitForURL('http://localhost:3000/')
  await session.page.goto('/settings')
  const settings = new SettingsView(session.page)
  const logout = await settings.logoutButton()
  await logout.click()
  await session.page.waitForURL('**/login**', { timeout: 15_000 })

  // The session is gone: protected routes bounce to sign-in, carrying where they were going.
  await session.page.goto('/schedule')
  await expect.poll(() => new URL(session.page.url()).pathname).toBe('/login')
  expect(new URL(session.page.url()).searchParams.get('next')).toBe('/schedule')
  await expect(session.page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible()
  await session.page.goto('/settings')
  await expect.poll(() => new URL(session.page.url()).pathname).toBe('/login')
  await guards.assertClean()
  await session.context.close()
}

test('SA-18: an admin logs out from Settings and protected routes then go to sign-in', async ({ browser, factory }) => {
  await logoutFromSettingsAs(browser, factory, 'admin')
})

test('SA-18: a staff member logs out from Settings and protected routes then go to sign-in', async ({ browser, factory }) => {
  await logoutFromSettingsAs(browser, factory, 'staff')
})
