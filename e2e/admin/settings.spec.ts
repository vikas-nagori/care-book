import type { Browser } from '@playwright/test'
import { SettingsView } from '../pages/settings-view'
import { CLINIC_A } from '../support/accounts'
import { attachErrorGuards } from '../support/assertions'
import { test, expect } from '../support/factories'

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

async function signInAs(browser: Browser, mobileNumber: string, password: string) {
  // `browser.newContext()` inherits the project's storageState (the admin session), so the
  // invitee's context must start explicitly signed out.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
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
  await expect(page.getByText('revoked', { exact: true }).filter({ visible: true })).toBeVisible()
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
