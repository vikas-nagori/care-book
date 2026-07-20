import { attachErrorGuards } from '../support/assertions'
import { test, expect } from '../support/factories'

function isFutureBan(bannedUntil: string | undefined): boolean {
  return Boolean(bannedUntil && Date.parse(bannedUntil) > Date.now())
}

test('approves a disposable onboarding request and persists its clinic and owner invite', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const request = await factory.createOnboardingRequest()
  const email = String(request.owner_email)
  factory.watchUiOnboardingRequest({ ownerEmail: email, clinicName: String(request.clinic_name) })
  factory.watchUiInvite(email)

  await page.goto('/platform/clinic-requests')
  await page.getByRole('button', { name: `Approve ${request.clinic_name}`, exact: true }).click()
  await expect(page.getByText('Clinic approved', { exact: true }).filter({ visible: true })).toBeVisible()

  await expect.poll(async () => (await factory.findOnboardingRequestByEmail(email))?.status).toBe('approved')
  const approved = await factory.findOnboardingRequestByEmail(email)
  expect(approved?.clinic_id).toBeTruthy()
  const clinic = await factory.findClinicById(approved!.clinic_id!)
  expect(clinic).toMatchObject({ name: request.clinic_name, status: 'active' })
  const invite = await factory.findInviteByEmail(email)
  expect(invite).toMatchObject({ clinic_id: approved!.clinic_id, email, role: 'admin', status: 'pending' })
  expect(invite?.auth_user_id).toBeTruthy()
  factory.trackAuthUser(invite!.auth_user_id!, email)
  factory.trackProfile(invite!.auth_user_id!)
  expect((await factory.getAuthUser(invite!.auth_user_id!)).email).toBe(email)
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
