import { test, expect } from '@playwright/test'

import { attachErrorGuards, gotoNotFoundRoute } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { SEED } from '../support/ids'

test('shows the shared appointment but not another staff member private appointment on dashboard and schedule', async ({ page }) => {
  const guards = attachErrorGuards(page)

  await page.goto('/')
  await expect(page.getByRole('link', { name: /Asha Rao/ }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /Ravi Kumar/ })).toHaveCount(0)

  await page.goto(`/schedule?date=${clinicDate()}`)
  const sharedAppointment = page.getByRole('link', { name: /Asha Rao/ }).filter({ visible: true })
  await expect(sharedAppointment).toBeVisible()
  await expect(page.getByRole('link', { name: /Ravi Kumar/ })).toHaveCount(0)

  await sharedAppointment.click()
  await expect(page).toHaveURL(`/schedule/${SEED.appointmentShared}`)
  await expect(page.getByText('Appointment', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Asha Rao', exact: true })).toBeVisible()
  await guards.assertClean()
})

test('omits another staff member private appointment from the patient history', async ({ page }) => {
  const guards = attachErrorGuards(page)

  await page.goto(`/patients/${SEED.patientRavi}?tab=appointments`)

  await expect(page.getByRole('tab', { name: 'Appts', exact: true })).toHaveAttribute('data-state', 'active')
  await expect(page.getByText('No appointments yet.', { exact: true })).toBeVisible()
  await guards.assertClean()
})

test('returns the exact Next not-found outcome for another staff member private appointment', async ({ page }) => {
  await gotoNotFoundRoute(page, `/schedule/${SEED.appointmentStaff2Private}`)
})
