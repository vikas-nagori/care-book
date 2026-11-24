// External Staff "Your account" page (plan 5.5, X-4): an email-less External Staff login (the
// normal shape for a clinician invited by mobile number) changes its password, logs out and signs
// back in with the new one.

import type { Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

import { press, signInWithMobile } from '../pages/external-dialogs'
import { CLINIC_A, PASSWORD } from '../support/accounts'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { test, expect } from '../support/factories'

const NEW_PASSWORD = 'E2e-Changed-Pass-456'

function guardsFor(page: Page) {
  // reportClientError's telemetry budget can answer 429 when the matrix runs back to back.
  return attachErrorGuards(page, { expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }] })
}

/** Can `password` sign this mobile number in right now? Checked against GoTrue, not the UI. */
async function canSignIn(mobileNumber: string, password: string): Promise<boolean> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ phone: mobileNumber, password })
  if (!error) await client.auth.signOut({ scope: 'local' })
  return !error
}

function accountValue(page: Page, label: 'Name' | 'Mobile' | 'Email' | 'Role') {
  return page.locator('dl > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd')
}

test('an email-less External Staff login changes its password, logs out and signs back in with the new one', async ({ page, factory }, testInfo) => {
  const user = await factory.createAuthUser({ clinicId: CLINIC_A.id, role: 'external_staff', email: null })
  const guards = guardsFor(page)
  await signInWithMobile(page, { mobileNumber: user.mobileNumber })
  await expect(page).toHaveURL(/\/external(?:\?|$)/)

  await page.goto('/external/account')
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible()
  await expect(accountValue(page, 'Email')).toHaveText('Not added yet')
  await expect(accountValue(page, 'Mobile')).toHaveText(`${user.mobileNumber.slice(0, 5)} ${user.mobileNumber.slice(5)}`)
  await expect(accountValue(page, 'Role')).toHaveText('External Staff')
  await expectNoLeakedNulls(page)

  const current = page.getByLabel('Current password', { exact: true })
  const next = page.getByLabel('New password', { exact: true })
  const confirm = page.getByLabel('Confirm new password', { exact: true })
  const change = page.getByRole('button', { name: /^(Change Password|Changing…)$/ })

  // Wrong current password: the error sits under that field and the button comes back.
  await current.fill('Wrong-Password-999')
  await next.fill(NEW_PASSWORD)
  await confirm.fill(NEW_PASSWORD)
  await press(change, testInfo)
  await expect(page.getByText('Your current password is incorrect.', { exact: true })).toBeVisible()
  await expect(current).toHaveAttribute('aria-invalid', 'true')
  await expect(change).toBeEnabled()
  await expect(change).toHaveAccessibleName('Change Password')
  expect(await canSignIn(user.mobileNumber, PASSWORD)).toBe(true)

  // The right one: changed, fields cleared, the new password works and the old one does not.
  await current.fill(PASSWORD)
  await press(change, testInfo)
  await expect(page.getByText('Password changed', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(current).toHaveValue('')
  await expect(change).toBeEnabled()
  await expect.poll(() => canSignIn(user.mobileNumber, NEW_PASSWORD)).toBe(true)
  expect(await canSignIn(user.mobileNumber, PASSWORD)).toBe(false)

  await press(page.getByRole('button', { name: 'Logout', exact: true }), testInfo)
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await page.goto('/external')
  await expect(page).toHaveURL(/\/login(?:\?|$)/)

  // Back in with the new password, then out again.
  await signInWithMobile(page, { mobileNumber: user.mobileNumber, password: NEW_PASSWORD })
  await expect(page).toHaveURL(/\/external(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true }).filter({ visible: true }).first()).toBeVisible()
  await page.goto('/external/account')
  await press(page.getByRole('button', { name: 'Logout', exact: true }), testInfo)
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await page.goto('/external')
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible()
  await guards.assertClean()
})
