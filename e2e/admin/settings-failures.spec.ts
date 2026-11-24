// Settings when a request fails (plan 5.4, SA-8 to SA-11).
//
// SA-8: the server (or the form) refuses the request and says why. SA-9: the request never gets
// an answer (`abort`). SA-10: the phone runs an older build. SA-11: the request is slow and the
// admin taps again. Every case proves the control comes back usable, nothing half-saved is left,
// and a corrected retry works. Cards on desktop and bottom sheets on a phone are different DOM, so
// SA-8 and SA-9 run on both admin projects; SA-10 and SA-11 are phone-only.
//
// Accounts whose password or session changes are throwaway factory users on their own context.

import type { Browser, Locator, Page, TestInfo } from '@playwright/test'
import { SettingsView, formatMobile } from '../pages/settings-view'
import { CLINIC_A, STAFF } from '../support/accounts'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { test, expect, type E2EFactory } from '../support/factories'
import {
  ACTION_UNREACHABLE_MESSAGE,
  STALE_DEPLOYMENT_MESSAGE,
  expectButtonRecovers,
  expectFailureMessage,
  expectedFaultConsoleErrors,
  failNextServerAction,
  holdNextServerAction,
} from '../support/fault-injection'
import { isMobileProject } from '../support/mobile'
import { adminClient } from '../support/supabase-admin'

// Faults must reach Playwright's router, not the service worker.
test.use({ serviceWorkers: 'block' })

function guardsFor(page: Page) {
  return attachErrorGuards(page, {
    expectedFailures: expectedFaultConsoleErrors('server-action'),
    // reportClientError's telemetry budget can answer 429 when the matrix runs back to back.
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }],
  })
}

/** A tap on a phone, a click on desktop. */
async function press(locator: Locator, testInfo: TestInfo) {
  if (isMobileProject(testInfo)) await locator.tap()
  else await locator.click()
}

async function openSettings(page: Page) {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true }).filter({ visible: true })).toBeVisible()
  return new SettingsView(page)
}

/** Every invite row for a mobile number in Clinic A (the factory helper returns only the newest). */
async function invitesForMobile(mobile: string) {
  const { data, error } = await adminClient()
    .from('user_invites').select('id, status, auth_user_id').eq('clinic_id', CLINIC_A.id).eq('mobile_number', mobile)
  if (error) throw new Error(`invites for mobile: ${error.message}`)
  return data ?? []
}

/** A pending, mobile-only invite with no login yet, cleaned up with whatever the UI attaches to it. */
async function pendingInvite(factory: E2EFactory) {
  const mobile = factory.uniqueMobile()
  factory.watchUiMobileInvite(mobile)
  const invite = await factory.createUserInvite({ clinicId: CLINIC_A.id, email: null, mobileNumber: mobile })
  return { invite, mobile, account: formatMobile(mobile) }
}

async function signInFresh(browser: Browser, mobile: string, password: string) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await page.goto('http://localhost:3000/login')
  await page.getByLabel('Mobile number', { exact: true }).fill(mobile)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await page.waitForURL('http://localhost:3000/', { timeout: 15_000 })
  return { context, page }
}

// ---------------------------------------------------------------------------------------------
// SA-8: refusals the app reports itself
// ---------------------------------------------------------------------------------------------

test('SA-8: a second invite for a pending mobile number is refused and a corrected one goes through', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const { mobile } = await pendingInvite(factory)
  const name = factory.uniqueName('duplicate-invite')
  const settings = await openSettings(page)

  const button = await settings.submitInvite({ name, phone: mobile })
  await expectFailureMessage(page, 'A pending invite already exists for this mobile number.')
  await expect(button).toBeEnabled()
  await expect(button).toHaveAccessibleName('Create Login')
  await expect(settings.tempPasswordDialog()).toHaveCount(0)
  expect(await invitesForMobile(mobile)).toHaveLength(1)
  await expect(page.getByLabel('Invitee name', { exact: true })).toHaveValue(name)

  const corrected = factory.uniqueMobile()
  factory.watchUiMobileInvite(corrected)
  await page.getByLabel(/^Mobile number/).fill(corrected)
  await press(button, testInfo)
  await settings.takeTempPassword()
  expect(await factory.findInviteByMobile(corrected)).toMatchObject({ status: 'pending', full_name: name })
  await guards.assertClean()
})

test('SA-8: inviting the mobile number of an active user is refused', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const name = factory.uniqueName('active-user-invite')
  const settings = await openSettings(page)

  const button = await settings.submitInvite({ name, phone: STAFF.mobile })
  await expectFailureMessage(page, 'This mobile number already belongs to an active user.')
  await expect(button).toBeEnabled()
  await expect(button).toHaveAccessibleName('Create Login')
  expect((await invitesForMobile(STAFF.mobile)).filter((invite) => invite.status === 'pending')).toEqual([])

  const corrected = factory.uniqueMobile()
  factory.watchUiMobileInvite(corrected)
  await page.getByLabel(/^Mobile number/).fill(corrected)
  await press(button, testInfo)
  await settings.takeTempPassword()
  expect(await factory.findInviteByMobile(corrected)).toMatchObject({ status: 'pending', full_name: name })
  await guards.assertClean()
})

test('SA-8: a malformed email or mobile number is refused before any request', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const name = factory.uniqueName('malformed-invite')
  const mobile = factory.uniqueMobile()
  factory.watchUiMobileInvite(mobile)
  const settings = await openSettings(page)
  let actionRequests = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.headers()['next-action']) actionRequests += 1
  })

  // Passes the browser's own email check, fails the app's (no dot in the domain).
  const button = await settings.submitInvite({ name, phone: mobile, email: 'someone@localhost' })
  await expectFailureMessage(page, 'Enter a valid email address.')
  await expect(button).toBeEnabled()

  await page.getByLabel('Invite email', { exact: true }).fill('')
  await page.getByLabel(/^Mobile number/).fill('12345')
  await press(button, testInfo)
  await expectFailureMessage(page, 'Enter your 10-digit mobile number, without +91 or 0.')
  await expect(button).toBeEnabled()
  expect(actionRequests).toBe(0)
  expect(await invitesForMobile('12345')).toEqual([])

  await page.getByLabel(/^Mobile number/).fill(mobile)
  await press(button, testInfo)
  await settings.takeTempPassword()
  expect(await factory.findInviteByMobile(mobile)).toMatchObject({ email: null, status: 'pending' })
  await guards.assertClean()
})

test('SA-8: a duplicate appointment-type name is refused and a unique one saves', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const existing = await factory.createAppointmentType()
  const unique = factory.uniqueName('type-unique')
  factory.watchUiAppointmentType(unique)
  const settings = await openSettings(page)
  await settings.openSection('Appointment Types')
  const scope = settings.sectionScope('Appointment Types')
  await scope.getByRole('button', { name: 'Add appointment type', exact: true }).click()
  await scope.getByLabel('Appointment type name', { exact: true }).fill(existing.name as string)
  await scope.getByLabel('Session rate (₹)', { exact: true }).fill('640')
  const save = scope.getByRole('button', { name: /^(Save|Saving…)$/ })
  await press(save, testInfo)

  await expectFailureMessage(page, 'An appointment type with that name already exists.')
  await expect(save).toBeEnabled()
  await expect(save).toHaveAccessibleName('Save')
  const { count } = await adminClient().from('appointment_types').select('id', { count: 'exact', head: true })
    .eq('clinic_id', CLINIC_A.id).eq('name', existing.name as string)
  expect(count).toBe(1)

  await scope.getByLabel('Appointment type name', { exact: true }).fill(unique)
  await press(save, testInfo)
  await expect(page.getByText('Appointment type added', { exact: true }).filter({ visible: true })).toBeVisible()
  expect(await factory.findAppointmentTypeByName(unique)).toMatchObject({ session_rate: 640 })
  await guards.assertClean()
})

test('SA-8: a type used by appointments cannot be deleted until it is free', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const type = await factory.createAppointmentType()
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, appointmentTypeId: type.id as string })
  const settings = await openSettings(page)
  await settings.openSection('Appointment Types')
  const remove = settings.sectionScope('Appointment Types').getByRole('button', { name: `Delete ${type.name}`, exact: true })
  await press(remove, testInfo)

  await expectFailureMessage(page, 'This type is used by existing appointments and cannot be deleted.')
  await expect(remove).toBeEnabled()
  expect(await factory.findAppointmentTypeByName(type.name as string)).not.toBeNull()

  // Once nothing uses it, the same button deletes it.
  await factory.deleteAppointmentHard(appointment.id)
  await press(remove, testInfo)
  await expect(page.getByText('Appointment type deleted', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect.poll(() => factory.findAppointmentTypeByName(type.name as string)).toBeNull()
  await guards.assertClean()
})

test('SA-8: New password on an invite revoked in another tab says so and changes nothing', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const { invite, account } = await pendingInvite(factory)
  const settings = await openSettings(page)
  await settings.openSection('Invites')
  const newPassword = settings.newPasswordButton(account)
  await expect(newPassword).toBeVisible()

  // The same admin revokes it from a second tab.
  const otherTab = await page.context().newPage()
  const other = await openSettings(otherTab)
  await other.revokeInvite(account)
  await otherTab.close()
  await expect.poll(async () => (await factory.findInviteByMobile(invite.mobile_number!))?.status).toBe('revoked')

  await press(newPassword, testInfo)
  await expectFailureMessage(page, 'Only pending invites can get a new temporary password.')
  await expect(newPassword).toBeEnabled()
  await expect(newPassword).toHaveText('New password')
  await expect(settings.tempPasswordDialog()).toHaveCount(0)
  expect(await factory.findInviteByMobile(invite.mobile_number!)).toMatchObject({ status: 'revoked', auth_user_id: null })

  // A refresh shows the truth: the invite is revoked and offers no actions.
  await page.reload()
  await settings.openSection('Invites')
  await expect(settings.newPasswordButton(account)).toHaveCount(0)
  await expect(settings.revokeButton(account)).toHaveCount(0)
  await guards.assertClean()
})

// ---------------------------------------------------------------------------------------------
// SA-9: no answer (`abort`) on each settings control
// ---------------------------------------------------------------------------------------------

test('SA-9: an aborted Create Login keeps the form, creates nothing, and the retry works', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const name = factory.uniqueName('abort-invite')
  const mobile = factory.uniqueMobile()
  factory.watchUiMobileInvite(mobile)
  const settings = await openSettings(page)
  await settings.fillInvite({ name, phone: mobile })
  const button = settings.createLoginButton()

  const fault = await failNextServerAction(page, 'abort')
  await press(button, testInfo)
  await expectButtonRecovers(button, { idleName: 'Create Login', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(page.getByLabel('Invitee name', { exact: true })).toHaveValue(name)
  await expect(page.getByLabel(/^Mobile number/)).toHaveValue(mobile)
  expect(await invitesForMobile(mobile)).toEqual([])

  await fault.dispose()
  await press(button, testInfo)
  await settings.takeTempPassword()
  expect(await invitesForMobile(mobile)).toHaveLength(1)
  await guards.assertClean()
})

test('SA-9: an aborted Save Settings saves nothing and the retry works', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const original = await factory.getGlobalSettings()
  try {
    const settings = await openSettings(page)
    await settings.openSection('Session Fees')
    const scope = settings.sectionScope('Session Fees')
    const clinicFee = scope.getByLabel('Clinic Visit Fee (₹)', { exact: true })
    const typed = String(Number(original.clinic_fee) + 29)
    await clinicFee.fill(typed)
    const save = scope.getByRole('button', { name: /^(Save Settings|Saving…)$/ })

    const fault = await failNextServerAction(page, 'abort')
    await press(save, testInfo)
    await expectButtonRecovers(save, { idleName: 'Save Settings', message: ACTION_UNREACHABLE_MESSAGE, fault })
    await expect(clinicFee).toHaveValue(typed)
    expect(Number((await factory.getGlobalSettings()).clinic_fee)).toBe(Number(original.clinic_fee))

    await fault.dispose()
    await press(save, testInfo)
    await expect(page.getByText('Settings saved', { exact: true }).filter({ visible: true })).toBeVisible()
    await expect.poll(async () => Number((await factory.getGlobalSettings()).clinic_fee)).toBe(Number(typed))
  } finally {
    await factory.restoreGlobalSettings(original)
  }
  await guards.assertClean()
})

test('SA-9: aborted appointment-type Save (add and edit) and Delete recover and the retries work', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const name = factory.uniqueName('abort-type')
  const edited = factory.uniqueName('abort-type-edited')
  factory.watchUiAppointmentType(name)
  factory.watchUiAppointmentType(edited)
  const settings = await openSettings(page)
  await settings.openSection('Appointment Types')
  const scope = settings.sectionScope('Appointment Types')
  const save = scope.getByRole('button', { name: /^(Save|Saving…)$/ })

  // Add
  await scope.getByRole('button', { name: 'Add appointment type', exact: true }).click()
  await scope.getByLabel('Appointment type name', { exact: true }).fill(name)
  await scope.getByLabel('Session rate (₹)', { exact: true }).fill('730')
  let fault = await failNextServerAction(page, 'abort')
  await press(save, testInfo)
  await expectButtonRecovers(save, { idleName: 'Save', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(scope.getByLabel('Appointment type name', { exact: true })).toHaveValue(name)
  expect(await factory.findAppointmentTypeByName(name)).toBeNull()
  await fault.dispose()
  await press(save, testInfo)
  await expect(page.getByText('Appointment type added', { exact: true }).filter({ visible: true })).toBeVisible()
  const created = await factory.findAppointmentTypeByName(name)
  expect(created).toMatchObject({ session_rate: 730 })

  // Edit
  await scope.getByRole('button', { name: `Edit ${name}`, exact: true }).click()
  await scope.getByLabel('Appointment type name', { exact: true }).fill(edited)
  fault = await failNextServerAction(page, 'abort')
  await press(save, testInfo)
  await expectButtonRecovers(save, { idleName: 'Save', message: ACTION_UNREACHABLE_MESSAGE, fault })
  expect(await factory.findAppointmentTypeByName(name)).toMatchObject({ id: created!.id })
  await fault.dispose()
  await press(save, testInfo)
  await expect(page.getByText('Appointment type updated', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect.poll(async () => (await factory.findAppointmentTypeByName(edited))?.id).toBe(created!.id)

  // Delete
  const remove = scope.getByRole('button', { name: `Delete ${edited}`, exact: true })
  fault = await failNextServerAction(page, 'abort')
  await press(remove, testInfo)
  await expectButtonRecovers(remove, { idleName: `Delete ${edited}`, message: ACTION_UNREACHABLE_MESSAGE, fault })
  expect(await factory.findAppointmentTypeByName(edited)).not.toBeNull()
  await fault.dispose()
  await press(remove, testInfo)
  await expect(page.getByText('Appointment type deleted', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect.poll(() => factory.findAppointmentTypeByName(edited)).toBeNull()
  await guards.assertClean()
})

test('SA-9: aborted package-template Save (add and edit) and Delete recover and the retries work', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const name = factory.uniqueName('abort-template')
  const edited = factory.uniqueName('abort-template-edited')
  factory.watchUiPackageTemplate(name)
  factory.watchUiPackageTemplate(edited)
  const settings = await openSettings(page)
  await settings.openSection('Package Templates')
  const scope = settings.sectionScope('Package Templates')
  const save = scope.getByRole('button', { name: /^(Save|Saving…)$/ })

  await scope.getByRole('button', { name: 'Add package template', exact: true }).click()
  await scope.getByLabel('Package template name', { exact: true }).fill(name)
  await scope.getByLabel('Minimum sessions', { exact: true }).fill('5')
  await scope.getByLabel('Rate / session (₹)', { exact: true }).fill('660')
  let fault = await failNextServerAction(page, 'abort')
  await press(save, testInfo)
  await expectButtonRecovers(save, { idleName: 'Save', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(scope.getByLabel('Package template name', { exact: true })).toHaveValue(name)
  expect(await factory.findPackageTemplateByName(name)).toBeNull()
  await fault.dispose()
  await press(save, testInfo)
  await expect(page.getByText('Template added', { exact: true }).filter({ visible: true })).toBeVisible()
  const created = await factory.findPackageTemplateByName(name)
  expect(created).toMatchObject({ min_sessions: 5, per_session_amount: 660 })

  await scope.getByRole('button', { name: `Edit ${name}`, exact: true }).click()
  await scope.getByLabel('Package template name', { exact: true }).fill(edited)
  fault = await failNextServerAction(page, 'abort')
  await press(save, testInfo)
  await expectButtonRecovers(save, { idleName: 'Save', message: ACTION_UNREACHABLE_MESSAGE, fault })
  expect(await factory.findPackageTemplateByName(name)).toMatchObject({ id: created!.id })
  await fault.dispose()
  await press(save, testInfo)
  await expect(page.getByText('Template updated', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect.poll(async () => (await factory.findPackageTemplateByName(edited))?.id).toBe(created!.id)

  const remove = scope.getByRole('button', { name: `Delete ${edited}`, exact: true })
  fault = await failNextServerAction(page, 'abort')
  await press(remove, testInfo)
  await expectButtonRecovers(remove, { idleName: `Delete ${edited}`, message: ACTION_UNREACHABLE_MESSAGE, fault })
  expect(await factory.findPackageTemplateByName(edited)).not.toBeNull()
  await fault.dispose()
  await press(remove, testInfo)
  await expect(page.getByText('Template deleted', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect.poll(() => factory.findPackageTemplateByName(edited)).toBeNull()
  await guards.assertClean()
})

test('SA-9: an aborted Add Temporary Staff keeps the form, adds nothing, and the retry works', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const name = factory.uniqueName('abort-temp-staff')
  const phone = factory.uniqueMobile()
  factory.watchUiExternalStaff({ name, phone })
  const settings = await openSettings(page)
  await settings.openSection('Temporary Staff')
  const scope = settings.sectionScope('Temporary Staff')
  await scope.getByLabel('Name *', { exact: true }).fill(name)
  await scope.getByLabel('Phone *', { exact: true }).fill(phone)
  const add = scope.getByRole('button', { name: /^(Add Temporary Staff|Adding\.\.\.)$/ })

  const fault = await failNextServerAction(page, 'abort')
  await press(add, testInfo)
  await expectButtonRecovers(add, { idleName: 'Add Temporary Staff', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(scope.getByLabel('Name *', { exact: true })).toHaveValue(name)
  expect(await factory.findExternalStaff({ name, phone })).toBeNull()

  await fault.dispose()
  await press(add, testInfo)
  await expect(page.getByText('Temporary staff added', { exact: true }).filter({ visible: true })).toBeVisible()
  expect(await factory.findExternalStaff({ name, phone })).toMatchObject({ email: null, status: 'active' })
  await guards.assertClean()
})

test('SA-9: an aborted Temporary Staff Create login creates no invite and the retry works', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const staff = await factory.createExternalStaff()
  const email = factory.uniqueEmail('abort-temp-login')
  factory.watchUiInvite(email)
  const settings = await openSettings(page)
  await settings.openSection('Temporary Staff')
  const row = settings.temporaryStaffRow(staff.name)
  await row.getByLabel(`Invite email for ${staff.name}`, { exact: true }).fill(email)
  const button = settings.createLoginForTemporaryStaffButton(staff.name)

  const fault = await failNextServerAction(page, 'abort')
  await press(button, testInfo)
  await expectButtonRecovers(button, { idleName: 'Create login', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(row.getByLabel(`Invite email for ${staff.name}`, { exact: true })).toHaveValue(email)
  expect(await factory.findInviteByEmail(email)).toBeNull()

  await fault.dispose()
  await press(button, testInfo)
  await settings.takeTempPassword()
  expect(await factory.findInviteByEmail(email)).toMatchObject({ external_staff_id: staff.id, status: 'pending' })
  await guards.assertClean()
})

test('SA-9: an aborted New password leaves the invite alone and the retry issues one', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const { mobile, account } = await pendingInvite(factory)
  const settings = await openSettings(page)
  await settings.openSection('Invites')
  const button = settings.newPasswordButton(account)

  const fault = await failNextServerAction(page, 'abort')
  await press(button, testInfo)
  await expectButtonRecovers(button, { idleName: `New temporary password for ${account}`, message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(button).toHaveText('New password')
  await expect(settings.revokeButton(account)).toBeEnabled()
  expect(await factory.findInviteByMobile(mobile)).toMatchObject({ status: 'pending', auth_user_id: null })

  await fault.dispose()
  await press(button, testInfo)
  await settings.takeTempPassword()
  expect((await factory.findInviteByMobile(mobile))?.auth_user_id).not.toBeNull()
  await guards.assertClean()
})

test('SA-9: an aborted Revoke leaves the invite pending and the retry revokes it', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const { mobile, account } = await pendingInvite(factory)
  const settings = await openSettings(page)
  await settings.openSection('Invites')
  const button = settings.revokeButton(account)

  const fault = await failNextServerAction(page, 'abort')
  await press(button, testInfo)
  await expectButtonRecovers(button, { idleName: `Revoke invite to ${account}`, message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(settings.newPasswordButton(account)).toBeEnabled()
  expect(await factory.findInviteByMobile(mobile)).toMatchObject({ status: 'pending' })

  await fault.dispose()
  await press(button, testInfo)
  await expect(page.getByText('Invite revoked', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect.poll(async () => (await factory.findInviteByMobile(mobile))?.status).toBe('revoked')
  await guards.assertClean()
})

test('SA-9: an aborted Change Password keeps the old password and the retry changes it', async ({ browser, factory }, testInfo) => {
  const user = await factory.createAuthUser({ clinicId: CLINIC_A.id, email: null, role: 'staff' })
  const session = await signInFresh(browser, user.mobileNumber, user.password)
  const page = session.page
  const guards = guardsFor(page)
  const settings = await openSettings(page)
  await settings.openSection('Your Account')
  const scope = settings.sectionScope('Your Account')
  const newPassword = `E2e-${factory.token}-Ab0rt`
  await scope.getByLabel('Current password', { exact: true }).fill(user.password)
  await scope.getByLabel('New password', { exact: true }).fill(newPassword)
  await scope.getByLabel('Confirm new password', { exact: true }).fill(newPassword)
  const button = scope.getByRole('button', { name: /^(Change Password|Changing…)$/ })

  const fault = await failNextServerAction(page, 'abort')
  await press(button, testInfo)
  await expect.poll(() => fault.hit()).toBe(true)
  // The form shows its own inline error (not a toast).
  await expect(scope.getByText(ACTION_UNREACHABLE_MESSAGE, { exact: true })).toBeVisible()
  await expect(button).toBeEnabled()
  await expect(button).toHaveAccessibleName('Change Password')
  await expect(scope.getByLabel('Current password', { exact: true })).toHaveValue(user.password)

  // Nothing changed: the old password still signs in.
  const check = await signInFresh(browser, user.mobileNumber, user.password)
  await check.context.close()

  await fault.dispose()
  await press(button, testInfo)
  await expect(page.getByText('Password changed', { exact: true }).filter({ visible: true })).toBeVisible()
  const changed = await signInFresh(browser, user.mobileNumber, newPassword)
  await changed.context.close()
  await guards.assertClean()
  await session.context.close()
})

// ---------------------------------------------------------------------------------------------
// SA-10, SA-11: stale build and slow requests on a phone
// ---------------------------------------------------------------------------------------------

test('SA-10: Create Login on a stale build says Care-Book was updated, reloads, and creates nothing', async ({ page, factory }, testInfo) => {
  testInfo.skip(!isMobileProject(testInfo), 'phone-only: a stale build after a deploy is a phone problem')
  const guards = guardsFor(page)
  const name = factory.uniqueName('stale-invite')
  const mobile = factory.uniqueMobile()
  factory.watchUiMobileInvite(mobile)
  const settings = await openSettings(page)
  await settings.fillInvite({ name, phone: mobile })
  const button = settings.createLoginButton()

  const fault = await failNextServerAction(page, 'stale-deployment')
  const reloaded = page.waitForEvent('load')
  await button.tap()
  await expectButtonRecovers(button, { idleName: 'Create Login', message: STALE_DEPLOYMENT_MESSAGE, fault })
  await reloaded
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('heading', { name: 'Settings', exact: true }).filter({ visible: true })).toBeVisible()
  expect(await invitesForMobile(mobile)).toEqual([])
  await fault.dispose()

  // After the reload the same invite goes through.
  const fresh = new SettingsView(page)
  await fresh.submitInvite({ name, phone: mobile })
  await fresh.takeTempPassword()
  expect(await invitesForMobile(mobile)).toHaveLength(1)
  await guards.assertClean()
})

test('SA-11: a slow Create Login shows Creating login…, ignores a double tap and Enter, and creates one invite', async ({ page, factory }, testInfo) => {
  testInfo.skip(!isMobileProject(testInfo), 'phone-only: double taps on a slow connection')
  const guards = guardsFor(page)
  const name = factory.uniqueName('slow-invite')
  const mobile = factory.uniqueMobile()
  factory.watchUiMobileInvite(mobile)
  const settings = await openSettings(page)
  await settings.fillInvite({ name, phone: mobile })
  const button = settings.createLoginButton()

  const hold = await holdNextServerAction(page)
  await button.dblclick()
  await hold.whenHeld()
  await expect(button).toHaveAccessibleName('Creating login…')
  await expect(button).toBeDisabled()
  await page.getByLabel('Invitee name', { exact: true }).press('Enter')
  expect(hold.count()).toBe(1)

  await hold.release()
  await settings.takeTempPassword()
  expect(hold.count()).toBe(1)
  expect(await invitesForMobile(mobile)).toHaveLength(1)
  await guards.assertClean()
})

test('SA-11: a slow Save Settings shows Saving…, ignores a double tap, and saves once', async ({ page, factory }, testInfo) => {
  testInfo.skip(!isMobileProject(testInfo), 'phone-only: double taps on a slow connection')
  const guards = guardsFor(page)
  const original = await factory.getGlobalSettings()
  try {
    const settings = await openSettings(page)
    await settings.openSection('Session Fees')
    const scope = settings.sectionScope('Session Fees')
    const typed = String(Number(original.clinic_fee) + 17)
    await scope.getByLabel('Clinic Visit Fee (₹)', { exact: true }).fill(typed)
    const save = scope.getByRole('button', { name: /^(Save Settings|Saving…)$/ })

    const hold = await holdNextServerAction(page)
    await save.dblclick()
    await hold.whenHeld()
    await expect(save).toHaveAccessibleName('Saving…')
    await expect(save).toBeDisabled()
    expect(hold.count()).toBe(1)
    await hold.release()
    await expect(page.getByText('Settings saved', { exact: true }).filter({ visible: true })).toBeVisible()
    await expect(save).toHaveAccessibleName('Save Settings')
    expect(hold.count()).toBe(1)
    await expect.poll(async () => Number((await factory.getGlobalSettings()).clinic_fee)).toBe(Number(typed))
  } finally {
    await factory.restoreGlobalSettings(original)
  }
  await guards.assertClean()
})

test('SA-11: a slow Revoke disables New password, ignores a double tap, and revokes once', async ({ page, factory }, testInfo) => {
  testInfo.skip(!isMobileProject(testInfo), 'phone-only: double taps on a slow connection')
  const guards = guardsFor(page)
  const { mobile, account } = await pendingInvite(factory)
  const settings = await openSettings(page)
  await settings.openSection('Invites')
  const revoke = settings.revokeButton(account)
  const newPassword = settings.newPasswordButton(account)

  const hold = await holdNextServerAction(page)
  await revoke.dblclick()
  await hold.whenHeld()
  await expect(revoke).toBeDisabled()
  await expect(newPassword).toBeDisabled()
  expect(hold.count()).toBe(1)
  await hold.release()
  await expect(page.getByText('Invite revoked', { exact: true }).filter({ visible: true })).toBeVisible()
  expect(hold.count()).toBe(1)
  await expect.poll(async () => (await factory.findInviteByMobile(mobile))?.status).toBe('revoked')
  expect(await invitesForMobile(mobile)).toHaveLength(1)
  await guards.assertClean()
})

test('SA-11: a slow New password shows Working... and disables Revoke until it finishes', async ({ page, factory }, testInfo) => {
  testInfo.skip(!isMobileProject(testInfo), 'phone-only: double taps on a slow connection')
  const guards = guardsFor(page)
  const { mobile, account } = await pendingInvite(factory)
  const settings = await openSettings(page)
  await settings.openSection('Invites')
  const revoke = settings.revokeButton(account)
  const newPassword = settings.newPasswordButton(account)

  const hold = await holdNextServerAction(page)
  await newPassword.dblclick()
  await hold.whenHeld()
  await expect(newPassword).toHaveText('Working...')
  await expect(newPassword).toBeDisabled()
  await expect(revoke).toBeDisabled()
  expect(hold.count()).toBe(1)
  await hold.release()
  await settings.takeTempPassword()
  expect(hold.count()).toBe(1)
  await expect(newPassword).toHaveText('New password')
  await expect(revoke).toBeEnabled()
  expect(await factory.findInviteByMobile(mobile)).toMatchObject({ status: 'pending' })
  await guards.assertClean()
})

// ---------------------------------------------------------------------------------------------
// G-15: Logout is a native <form action>, outside callServerAction, with no pending state. When
// its request fails the user should get the same plain message as every other control and stay
// where they are; today the rejection is unhandled. Remove test.fail when G-15 is fixed.
// ---------------------------------------------------------------------------------------------

test.fail('G-15 SA-18: a Logout whose request fails says so and leaves Settings usable', async ({ browser, factory }) => {
  const user = await factory.createAuthUser({ clinicId: CLINIC_A.id, role: 'staff' })
  const session = await signInFresh(browser, user.mobileNumber, user.password)
  const page = session.page
  const settings = await openSettings(page)
  const logout = await settings.logoutButton()

  const fault = await failNextServerAction(page, 'abort')
  await logout.click()
  await expectButtonRecovers(logout, { idleName: 'Logout', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(page).toHaveURL(/\/settings$/)
  await expectNoLeakedNulls(page)
  await session.context.close()
})
