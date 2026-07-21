import { test, expect } from '@playwright/test'

import { attachErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { SEED } from '../support/ids'

test('hides appointment fees and payment signals from the staff dashboard', async ({ page }) => {
  const guards = attachErrorGuards(page)

  await page.goto('/')

  await expect(page.getByText('₹800', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /This month.*collected/i })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Outstanding.*payment due/i })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'New billing', exact: true })).toHaveCount(0)
  await guards.assertClean()
})

test('hides schedule and appointment-detail payment signals from staff', async ({ page }) => {
  const guards = attachErrorGuards(page)

  await page.goto(`/schedule?date=${clinicDate()}`)
  const sharedAppointment = page.getByRole('link', { name: /Asha Rao/ }).filter({ visible: true })
  await expect(sharedAppointment).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Day total', exact: true })).toHaveCount(0)
  await expect(page.getByText('Expected', { exact: true })).toHaveCount(0)
  await expect(page.getByText('₹800', { exact: true })).toHaveCount(0)

  await sharedAppointment.click()
  await expect(page).toHaveURL(`/schedule/${SEED.appointmentShared}`)
  await expect(page.getByText('₹800', { exact: true })).toHaveCount(0)
  await expect(page.getByText('· prepaid', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Edit Appointment' })).toBeVisible()
  await expect(page.getByLabel('Session Fee (₹)', { exact: true })).toHaveCount(0)

  const appointmentTypesRequest = page.waitForRequest((request) =>
    request.url().includes('/rest/v1/appointment_types?')
  )
  await page.goto('/schedule/new')
  await expect(page.getByLabel('Session Fee (₹)', { exact: true })).toHaveCount(0)
  const selectedFields = new URL((await appointmentTypesRequest).url()).searchParams.get('select')
  expect(selectedFields).not.toBe('*')
  expect(selectedFields).not.toContain('session_rate')
  await guards.assertClean()
})

test('does not serialize payment fields into staff appointment detail responses', async ({ page }) => {
  const response = await page.goto(`/schedule/${SEED.appointmentShared}`)
  expect(response).not.toBeNull()

  const body = await response!.text()
  expect(body).not.toMatch(/\\?"fee\\?":800/)
  expect(body).not.toContain('payment_status')
})

test('hides the patient billing tab, package, payment history, and amounts from staff', async ({ page }) => {
  const guards = attachErrorGuards(page)

  await page.goto(`/patients/${SEED.patientAsha}`)

  await expect(page.getByRole('tab', { name: 'Billing', exact: true })).toHaveCount(0)
  await expect(page.getByText('10-Session Physiotherapy Package', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Payment History', exact: true })).toHaveCount(0)
  await expect(page.getByText('₹8,000', { exact: true })).toHaveCount(0)
  await guards.assertClean()
})
