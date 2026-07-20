import { test, expect } from '@playwright/test'

import { attachErrorGuards, gotoNotFoundRoute } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { SEED } from '../support/ids'

test('isolates Clinic B patient list, detail, and edit routes from the Clinic A admin', async ({ page }) => {
  const guards = attachErrorGuards(page)

  await page.goto('/patients')
  const search = page.getByPlaceholder('Search by name or phone…')
  await expect(page.getByText('Asha Rao', { exact: true }).filter({ visible: true })).toBeVisible()
  await search.fill('Clinic B Patient')
  await expect(page.getByText('Clinic B Patient', { exact: true })).toHaveCount(0)
  await search.fill('Asha Rao')
  await expect(page.getByText('Asha Rao', { exact: true }).filter({ visible: true })).toBeVisible()
  await guards.assertClean()

  await gotoNotFoundRoute(page, `/patients/${SEED.patientClinicB}`)
  await gotoNotFoundRoute(page, `/patients/${SEED.patientClinicB}/edit`)
})

test('isolates Clinic B schedule rows and appointment route from the Clinic A admin', async ({ page }) => {
  const guards = attachErrorGuards(page)

  await page.goto(`/schedule?date=${clinicDate()}`)
  await expect(page.getByRole('link', { name: /Asha Rao/ }).filter({ visible: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Clinic B Patient/ })).toHaveCount(0)
  await guards.assertClean()

  await gotoNotFoundRoute(page, `/schedule/${SEED.appointmentClinicB}`)
})
