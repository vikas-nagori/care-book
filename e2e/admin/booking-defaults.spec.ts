// New bookings price from the patient's history and default the assignee to the booker.

import { ADMIN } from '../support/accounts'
import { attachErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'

test("prefills the fee from the patient's last session of the type", async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const sharedType = await factory.findAppointmentType(true)
  await factory.createAppointment({
    patientId: patient.id as string, appointmentTypeId: sharedType.id, date: clinicDate(-7), fee: 1350,
  })

  await page.goto(`/schedule/new`)
  await page.getByLabel('Patient *', { exact: true }).fill(patient.name as string)
  await page.getByRole('button', { name: patient.name as string, exact: true }).click()
  await page.getByLabel('Type', { exact: true }).click()
  await page.getByRole('option', { name: sharedType.name, exact: true }).click()

  await expect(page.getByLabel('Session Fee (₹)', { exact: true })).toHaveValue('1350')
  await expect(page.getByText(`From this patient’s last ${sharedType.name} session.`, { exact: true })).toBeVisible()
  // Shared types carry no internal assignee; with no External Staff shared, there is nothing to pick.
  await expect(page.getByLabel('Assigned Staff', { exact: true })).toHaveCount(0)
  await guards.assertClean()
})

test('defaults a restricted booking to the admin who is booking, tagged by role', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const admin = await factory.findProfileByEmail(ADMIN.email)
  const privateType = await factory.findAppointmentType(false)

  await page.goto('/schedule/new')
  await page.getByLabel('Type', { exact: true }).click()
  await page.getByRole('option', { name: privateType.name, exact: true }).click()

  const assignee = page.getByLabel('Assigned Staff', { exact: true })
  await expect(assignee).toContainText(admin.full_name || admin.email)
  await expect(assignee).toContainText('ADMIN')
  await guards.assertClean()
})
