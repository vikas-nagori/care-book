import { SettingsView } from '../pages/settings-view'
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

test('creates external staff without sending an invite', async ({ page, factory }) => {
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

test('invites a unique user, resends the pending invite, and revokes it', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('invited-staff')
  const phone = stablePhone(name)
  const email = `${factory.token}-invite@carebook.test`
  factory.watchUiInvite(email)

  await page.goto('/settings')
  const settings = new SettingsView(page)
  await settings.inviteUser({ name, phone, email })
  let invite = await factory.findInviteByEmail(email)
  expect(invite).toMatchObject({
    email,
    role: 'staff',
    status: 'pending',
  })
  expect(invite!.auth_user_id).not.toBeNull()
  const beforeResend = invite!.updated_at

  await settings.resendInvite(email)
  await expect.poll(async () => (await factory.findInviteByEmail(email))?.updated_at).not.toBe(beforeResend)
  invite = await factory.findInviteByEmail(email)
  expect(invite?.status).toBe('pending')

  await settings.revokeInvite(email)
  await expect(page.getByText('revoked', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect.poll(async () => (await factory.findInviteByEmail(email))?.status).toBe('revoked')
  await guards.assertClean()
})
