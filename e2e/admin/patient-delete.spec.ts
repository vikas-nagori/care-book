// Admin-only: an empty patient record may be deleted, but immutable billing history must remain
// attached to its patient. The confirmation requires typing the patient's name.

import { attachErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'

test('admin deletes an empty patient after typing the name to confirm', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const patientName = patient.name as string

  await page.goto(`/patients/${patient.id}`)

  // Open the confirmation from the visible header (desktop or mobile depending on the project).
  await page.getByRole('button', { name: 'Delete', exact: true }).filter({ visible: true }).first().click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()

  // The confirm action stays disabled until the exact patient name is typed.
  const confirmButton = dialog.getByRole('button', { name: 'Delete', exact: true })
  await expect(confirmButton).toBeDisabled()

  await page.getByTestId('confirm-delete-patient-input').fill('not the name')
  await expect(confirmButton).toBeDisabled()

  await page.getByTestId('confirm-delete-patient-input').fill(patientName)
  await expect(confirmButton).toBeEnabled()
  await confirmButton.click()

  // Lands back on the patient list.
  await expect(page).toHaveURL(/\/patients$/)

  // The empty patient is gone from the database.
  await expect.poll(async () => await factory.findPatientByName(patientName)).toBeNull()

  await guards.assertClean()
})

test('admin cannot delete a patient whose immutable billing history must be retained', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const patientName = patient.name as string
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(-1), time: '09:00' })
  const payment = await factory.createPayment({ patientId: patient.id })

  await page.goto(`/patients/${patient.id}`)
  await page.getByRole('button', { name: 'Delete', exact: true }).filter({ visible: true }).first().click()
  await page.getByTestId('confirm-delete-patient-input').fill(patientName)
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()

  await expect(page.getByText('Delete failed', { exact: true })).toBeVisible()
  await expect(page.getByText('Patients with billing history cannot be deleted because their audit trail must be retained.', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}$`))
  expect(await factory.findPatientByName(patientName)).not.toBeNull()
  expect((await factory.findAppointments({ patientId: patient.id })).map((row) => row.id)).toContain(appointment.id)
  expect(await factory.findPayment({ patientId: patient.id, notes: payment.notes as string })).not.toBeNull()

  await guards.assertClean()
})
