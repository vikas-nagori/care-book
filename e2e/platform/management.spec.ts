import { attachErrorGuards } from '../support/assertions'
import { test, expect } from '../support/factories'

function isFutureBan(bannedUntil: string | undefined): boolean {
  return Boolean(bannedUntil && Date.parse(bannedUntil) > Date.now())
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
  await expect(ownerRow).toContainText('admin')
  await expect(ownerRow).toContainText(String(clinic!.name))
  await expect(ownerRow).toContainText('invite pending')

  // First login with the temp password: middleware forces the change page before anything else.
  // `browser.newContext()` inherits the project's storageState (the platform admin session), so
  // the owner's context must start explicitly signed out.
  const ownerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const ownerPage = await ownerContext.newPage()
  const ownerGuards = attachErrorGuards(ownerPage)
  await ownerPage.goto('http://localhost:3000/login')
  await ownerPage.getByLabel('Email').fill(email)
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
  await userPage.getByLabel('Email').fill(pending.email)
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
