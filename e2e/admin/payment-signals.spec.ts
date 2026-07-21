import { test, expect } from '@playwright/test'

import { attachErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { SEED } from '../support/ids'

test('shows the seeded appointment fee and payment signals on the admin dashboard', async ({ page }) => {
  const guards = attachErrorGuards(page)

  await page.goto('/')

  const seededAppointment = page
    .getByRole('link', { name: /Asha Rao/ })
    .filter({ hasText: '₹800', visible: true })
    .first()
  await expect(seededAppointment).toBeVisible()
  await expect(page.getByRole('link', { name: /This month.*collected/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Outstanding.*payment due/i })).toBeVisible()
  await guards.assertClean()
})

test('shows seeded schedule, appointment, and patient payment signals to admins', async ({ page }, testInfo) => {
  const guards = attachErrorGuards(page)

  await page.goto(`/schedule?date=${clinicDate()}`)
  const sharedAppointment = page.getByRole('link', { name: /Asha Rao/ }).filter({ visible: true })
  await expect(sharedAppointment).toBeVisible()
  if (testInfo.project.name.endsWith('-desktop')) {
    await expect(page.getByRole('heading', { name: 'Day total', exact: true })).toBeVisible()
    await expect(page.getByText('Expected', { exact: true })).toBeVisible()
  }

  await sharedAppointment.click()
  await expect(page).toHaveURL(`/schedule/${SEED.appointmentShared}`)
  await expect(page.getByText('₹800', { exact: true })).toBeVisible()
  await expect(page.getByText('· prepaid', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByLabel('Session Fee (₹)', { exact: true })).toHaveValue('800')
  await page.getByRole('button', { name: 'Close' }).click()

  await page.goto('/schedule/new')
  await expect(page.getByLabel('Session Fee (₹)', { exact: true })).toBeVisible()

  await page.goto(`/patients/${SEED.patientAsha}`)
  await page.getByRole('tab', { name: 'Billing', exact: true }).click()
  await expect(page.getByText('10-Session Physiotherapy Package', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Payment History', exact: true })).toBeVisible()
  await expect(page.getByText('₹8,000', { exact: true }).first()).toBeVisible()
  await guards.assertClean()
})
