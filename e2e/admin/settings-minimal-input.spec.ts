// Settings with the optional fields left blank (plan 5.4, SA-1 to SA-4).
//
// Incident 2026-11-24: a mobile-only invite (no email) made /settings throw on every render. These
// cases put email-less, nameless and phone-less people into every place Settings and the screens
// around it show them, and run the leak check on each: every bottom sheet on a phone, the panels
// on desktop. Accounts that change a password or log out are throwaway users on their own context.

import type { Browser, Locator, Page } from '@playwright/test'
import { SettingsView, STAFF_SETTINGS_SECTIONS, formatMobile } from '../pages/settings-view'
import { CLINIC_A } from '../support/accounts'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect, type E2EFactory } from '../support/factories'
import { SEED, SPARSE_NAMES, SPARSE_PROFILES } from '../support/ids'
import { isMobileProject } from '../support/mobile'

/** Signs in on a context of its own (never the shared admin session) and waits to leave /login. */
async function signInFresh(browser: Browser, mobile: string, password: string) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await page.goto('http://localhost:3000/login')
  await page.getByLabel('Mobile number', { exact: true }).fill(mobile)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 })
  return { context, page }
}

async function completeFirstLogin(page: Page, newPassword: string) {
  await page.waitForURL('**/auth/change-password', { timeout: 15_000 })
  await page.getByLabel('New password', { exact: true }).fill(newPassword)
  await page.getByLabel('Confirm new password', { exact: true }).fill(newPassword)
  await page.getByLabel('Confirm new password', { exact: true }).press('Enter')
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/') && !url.pathname.startsWith('/login'), { timeout: 15_000 })
}

/** The value next to a label in the Your Account summary (`<dt>Email</dt><dd>…</dd>`). */
function accountValue(scope: Locator, label: 'Name' | 'Email' | 'Mobile' | 'Role'): Locator {
  return scope.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]')
}

async function leakCheckEverySection(page: Page) {
  await new SettingsView(page).visitEverySection(async (scope) => {
    await expectNoLeakedNulls(page, { scope })
  })
}

/** A restricted-type appointment today, assigned as `assignment`, on a patient with no phone. */
async function bookRestricted(factory: E2EFactory, assignment: Record<string, string>) {
  const type = await factory.findAppointmentType(false)
  const patient = await factory.createPatient({ phone: null })
  const appointment = await factory.createAppointment({
    patientId: patient.id,
    appointmentTypeId: type.id,
    type: type.name,
    type_is_shared: false,
    date: clinicDate(),
    time: '20:30',
    fee: null,
    notes: null,
    ...assignment,
  })
  return { patient, appointment }
}

/** Schedule chip → detail → dashboard, leak-checking each screen the booking shows on. */
async function leakCheckBooking(page: Page, booking: { patient: { name: string }; appointment: { id: string } }, assignee: string) {
  await page.goto(`/schedule?date=${clinicDate()}`)
  const chip = page.locator(`a[href="/schedule/${booking.appointment.id}"]`).filter({ visible: true }).first()
  await expect(chip).toBeVisible()
  await expectNoLeakedNulls(page)
  await chip.click()
  await expect(page).toHaveURL(new RegExp(`/schedule/${booking.appointment.id}$`))
  await expect(page.getByText(booking.patient.name, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByText(assignee, { exact: false }).filter({ visible: true }).first()).toBeVisible()
  await expectNoLeakedNulls(page)
  await page.goto('/')
  await expect(page.getByText(booking.patient.name, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expectNoLeakedNulls(page)
}

test('SA-1: a mobile-only Staff invitee who has signed in renders cleanly in Settings, on the schedule and in the patient access picker', async ({ page, browser, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('mobile-only-staff')
  const phone = factory.uniqueMobile()
  factory.watchUiMobileInvite(phone)

  await page.goto('/settings')
  const settings = new SettingsView(page)
  // Required fields only: no email, default role (Staff).
  const tempPassword = await settings.inviteUser({ name, phone })
  const invite = await factory.findInviteByMobile(phone)
  expect(invite).toMatchObject({ email: null, role: 'staff', status: 'pending', full_name: name })

  const invitee = await signInFresh(browser, phone, tempPassword)
  const inviteeGuards = attachErrorGuards(invitee.page)
  await completeFirstLogin(invitee.page, `E2e-${factory.token}-M1nim`)
  await expectNoLeakedNulls(invitee.page)
  await inviteeGuards.assertClean()
  await invitee.context.close()
  await expect.poll(async () => (await factory.findInviteByMobile(phone))?.status).toBe('accepted')
  const profileId = invite!.auth_user_id!

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true }).filter({ visible: true })).toBeVisible()
  await leakCheckEverySection(page)
  await settings.openSection('Active Users')
  // Desktop renders the Invites and Active Users tables side by side: match the Users row, whose
  // name cell is the name alone.
  const userRow = settings.isMobile()
    ? settings.sectionScope('Active Users').locator('section').filter({ hasText: name })
    : page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) })
  await expect(userRow).toBeVisible()
  await expectNoLeakedNulls(page, { scope: userRow })

  // Booked to them: the schedule chip, the appointment detail and the dashboard.
  const booking = await bookRestricted(factory, { assigned_to: profileId })
  await leakCheckBooking(page, booking, name)

  // The patient page with its External Staff access picker.
  await page.goto(`/patients/${booking.patient.id}`)
  await expect(page.getByText('Save access', { exact: true }).or(page.getByRole('button', { name: 'Save access', exact: true })).first()).toBeVisible()
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

// The Active Users row of an email-less user names them by their formatted mobile number on both
// layouts (G-24 / SA-NEW-1: the desktop table used to show the raw 10 digits and an em dash).
test('SA-1: the Active Users row of a mobile-only user shows the formatted mobile number', async ({ page, factory }, testInfo) => {
  const guards = attachErrorGuards(page)
  const user = await factory.createAuthUser({ clinicId: CLINIC_A.id, email: null, role: 'staff' })
  await page.goto('/settings')
  const settings = new SettingsView(page)
  await settings.openSection('Active Users')
  const scope = settings.sectionScope('Active Users')
  const name = user.profile.full_name as string
  const row = isMobileProject(testInfo)
    ? scope.locator('section').filter({ hasText: name })
    : scope.getByRole('row').filter({ hasText: name })
  await expect(row).toBeVisible()
  await expect(row.getByText(formatMobile(user.mobileNumber), { exact: true })).toBeVisible()
  await expect(row).not.toContainText(user.mobileNumber)
  await expect(row).not.toContainText('—')
  await expectNoLeakedNulls(page, { scope: row })
  await guards.assertClean()
})

/** Signs an email-less account in and opens its account summary: Settings, or the External page. */
async function openEmailLessAccount(browser: Browser, factory: E2EFactory, role: 'staff' | 'external_staff') {
  const user = await factory.createAuthUser({ clinicId: CLINIC_A.id, email: null, role })
  const session = await signInFresh(browser, user.mobileNumber, user.password)
  const page = session.page
  const guards = attachErrorGuards(page)

  let scope: Locator
  if (role === 'staff') {
    await page.goto('/settings')
    const settings = new SettingsView(page)
    await settings.visitEverySection(async (sectionScope) => {
      await expectNoLeakedNulls(page, { scope: sectionScope })
    }, STAFF_SETTINGS_SECTIONS)
    await settings.openSection('Your Account')
    scope = settings.sectionScope('Your Account')
  } else {
    await expect(page).toHaveURL(/\/external$/)
    await page.goto('/external/account')
    await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible()
    scope = page.locator('body')
  }
  await expect(accountValue(scope, 'Email').filter({ visible: true })).toHaveText('Not added yet')
  await expect(accountValue(scope, 'Mobile').filter({ visible: true })).toHaveText(formatMobile(user.mobileNumber))
  return { user, session, page, guards, scope }
}

/** Changes the password (re-verified through the mobile number), logs out, signs in with the new one. */
async function changePasswordAndLogOut(
  browser: Browser,
  factory: E2EFactory,
  role: 'staff' | 'external_staff',
  account: Awaited<ReturnType<typeof openEmailLessAccount>>,
) {
  const { user, session, page, guards, scope } = account
  // The current password is re-checked through the mobile number (there is no email to use).
  const newPassword = `E2e-${factory.token}-N0Mail`
  await scope.getByLabel('Current password', { exact: true }).fill(user.password)
  await scope.getByLabel('New password', { exact: true }).fill(newPassword)
  await scope.getByLabel('Confirm new password', { exact: true }).fill(newPassword)
  await scope.getByRole('button', { name: 'Change Password', exact: true }).click()
  await expect(page.getByText('Password changed', { exact: true }).filter({ visible: true })).toBeVisible()

  await scope.getByRole('button', { name: 'Logout', exact: true }).click()
  await page.waitForURL('**/login**', { timeout: 15_000 })
  await guards.assertClean()
  await session.context.close()

  // Only the new password works now.
  const again = await signInFresh(browser, user.mobileNumber, newPassword)
  await expect(again.page).toHaveURL(role === 'staff' ? 'http://localhost:3000/' : /\/external$/)
  await again.context.close()
}

test('SA-2: an email-less Staff account reads "Not added yet", changes its password by mobile number and logs out', async ({ browser, factory }) => {
  const account = await openEmailLessAccount(browser, factory, 'staff')
  await expectNoLeakedNulls(account.page, { scope: account.scope })
  await changePasswordAndLogOut(browser, factory, 'staff', account)
})

test('SA-2: an email-less External Staff account reads "Not added yet", changes its password by mobile number and logs out', async ({ browser, factory }) => {
  const account = await openEmailLessAccount(browser, factory, 'external_staff')
  await expectNoLeakedNulls(account.page, { scope: account.scope })
  await changePasswordAndLogOut(browser, factory, 'external_staff', account)
})

test('SA-3: a restricted appointment assigned to the email-less Temporary Staff fixture renders cleanly on the schedule, detail and dashboard', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const booking = await bookRestricted(factory, { external_staff_id: SEED.externalStaffSparse })
  await leakCheckBooking(page, booking, SPARSE_NAMES.externalStaff)
  await guards.assertClean()
})

test('SA-4: every Settings section renders the sparse invites, users and Temporary Staff without leaking a null', async ({ page }, testInfo) => {
  const guards = attachErrorGuards(page)
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true }).filter({ visible: true })).toBeVisible()
  const settings = new SettingsView(page)
  await leakCheckEverySection(page)

  // The deterministic NULL rows are really on screen (not filtered away before the check).
  await settings.openSection('Invites')
  const invites = settings.sectionScope('Invites')
  await expect(invites.getByText(SPARSE_NAMES.inviteMobileOnly.fullName, { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(invites.getByText(formatMobile(SPARSE_NAMES.inviteMobileOnly.mobile), { exact: true }).filter({ visible: true })).toBeVisible()
  // The legacy invite has no name: it is labelled by its email.
  await expect(invites.getByText(SPARSE_NAMES.inviteLegacy.email, { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(settings.revokeButton(formatMobile(SPARSE_NAMES.inviteMobileOnly.mobile))).toBeVisible()

  await settings.openSection('Active Users')
  const users = settings.sectionScope('Active Users')
  await expect(users.getByText(SPARSE_PROFILES.mobileOnly.fullName, { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(users.getByText(SPARSE_PROFILES.nameless.email, { exact: true }).filter({ visible: true }).first()).toBeVisible()

  await settings.openSection('Temporary Staff')
  await expect(settings.temporaryStaffRow(SPARSE_NAMES.externalStaff)).toBeVisible()
  await expect(settings.temporaryStaffRow(SPARSE_NAMES.externalStaff).getByLabel(`Invite email for ${SPARSE_NAMES.externalStaff}`, { exact: true })).toHaveValue('')
  if (isMobileProject(testInfo)) await settings.closeOpenDialogs()
  await guards.assertClean()
})
