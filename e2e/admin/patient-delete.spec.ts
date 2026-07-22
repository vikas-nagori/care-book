// Admin-only: deleting a patient wipes the patient and all associated records (appointments,
// packages, payments) via ON DELETE CASCADE. The confirmation requires typing the patient's name.

import { attachErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'

test('admin deletes a patient and all associated records after typing the name to confirm', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const patientName = patient.name as string
  // Seed child records to prove the cascade removes them along with the patient.
  await factory.createAppointment({ patientId: patient.id, date: clinicDate(-1), time: '09:00' })
  const payment = await factory.createPayment({ patientId: patient.id })

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

  // The patient and its children are gone from the database.
  await expect.poll(async () => await factory.findPatientByName(patientName)).toBeNull()
  await expect
    .poll(async () => (await factory.findAppointments({ patientId: patient.id })).length)
    .toBe(0)
  expect(await factory.findPayment({ patientId: patient.id, notes: payment.notes as string })).toBeNull()

  await guards.assertClean()
})
