// Admin-only coverage for the "Total billed" drill-down's per-appointment-type breakdown strip and
// the payment-mode default. Data is built per-test with the factory so assertions don't depend on
// other specs' rows: the strip aggregates the whole clinic's completed sessions this month, so we
// only assert that the two types we created are present, never exact clinic-wide totals.

import { BillingEntryForm } from '../pages/billing-entry-form'
import { attachErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'

test('Billed drill-down shows a per-appointment-type breakdown strip', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const clinicType = await factory.findAppointmentType(true) // seeded shared "Clinic"
  const homeType = await factory.findAppointmentType(false) // seeded private "Home"

  await factory.createAppointment({
    patientId: patient.id,
    appointmentTypeId: clinicType.id,
    type: clinicType.name,
    date: clinicDate(),
    time: '09:15',
    fee: 800,
    status: 'completed',
    payment_status: 'unpaid',
  })
  await factory.createAppointment({
    patientId: patient.id,
    appointmentTypeId: homeType.id,
    type: homeType.name,
    date: clinicDate(),
    time: '10:15',
    fee: 1000,
    status: 'completed',
    payment_status: 'unpaid',
  })

  await page.goto('/billing/metrics/billed-this-month')

  const strip = page.getByLabel('Billed by appointment type')
  await expect(strip).toBeVisible()
  await expect(strip.getByText(clinicType.name, { exact: true })).toBeVisible()
  await expect(strip.getByText(homeType.name, { exact: true })).toBeVisible()

  await guards.assertClean()
})

test('Received drill-down does NOT show the appointment-type strip', async ({ page }) => {
  const guards = attachErrorGuards(page)
  await page.goto('/billing/metrics/received-this-month')
  await expect(page.getByLabel('Billed by appointment type')).toHaveCount(0)
  await guards.assertClean()
})

test('New billing entry defaults the payment mode to UPI', async ({ page }) => {
  const guards = attachErrorGuards(page)
  await page.goto('/billing')

  const form = new BillingEntryForm(page)
  await form.open()
  // The Payment Method select's trigger shows the preselected value.
  await expect(page.getByLabel('Payment Method *', { exact: true })).toContainText('UPI')

  await guards.assertClean()
})
