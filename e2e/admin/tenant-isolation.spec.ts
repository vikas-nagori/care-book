import { test, expect } from '@playwright/test'

import { BillingEntryForm } from '../pages/billing-entry-form'
import { attachErrorGuards, gotoNotFoundRoute } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { SEED } from '../support/ids'

test('isolates Clinic B patient list, detail, and edit routes from the Clinic A admin', async ({ page }) => {
  const guards = attachErrorGuards(page)

  await page.goto('/patients')
  const search = page.getByPlaceholder('Search by name or phone…')
  await expect(page.getByText('Asha Rao', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText('Clinic B Patient', { exact: true })).toHaveCount(0)
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

// B-17. Billing reads are clinic-scoped by RLS: Clinic B's package and patient do not exist for the
// Clinic A admin on the package and payment-due routes, the PDF API, or the entry form's picker.
test('isolates Clinic B billing: package and payment-due routes, the PDF API and the entry picker', async ({ page }) => {
  await gotoNotFoundRoute(page, `/billing/packages/${SEED.packageClinicB}`)
  await gotoNotFoundRoute(page, `/billing/payment-due/${SEED.patientClinicB}`)

  const response = await page.request.post(`/api/billing/payment-due/${SEED.patientClinicB}/pdf`, {
    data: { regularScope: 'all_due' },
  })
  expect(response.status()).toBe(404)
  expect(await response.json()).toMatchObject({ errorCode: 'NOT_FOUND' })

  const guards = attachErrorGuards(page)
  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()
  await page.getByLabel('Patient *', { exact: true }).click()
  const search = page.getByPlaceholder('Search patient…', { exact: true })
  await search.fill('Asha Rao')
  await expect(page.getByRole('button', { name: 'Asha Rao', exact: true })).toBeVisible()
  await search.fill('Clinic B Patient')
  await expect(page.getByText('No patients found.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clinic B Patient', exact: true })).toHaveCount(0)
  await guards.assertClean()
})
