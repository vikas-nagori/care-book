import { attachErrorGuards } from '../support/assertions'
import { test, expect } from '../support/factories'

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
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill('incorrect-e2e-password')
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page.getByText('Invalid login credentials', { exact: true })).toBeVisible()

  // The negative control intentionally receives a 400 from GoTrue; guard the successful retry.
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
  await page.getByLabel('Email').fill(pending.email)
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
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(newPassword)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page).toHaveURL('http://localhost:3000/')
  await guards.assertClean()
})
