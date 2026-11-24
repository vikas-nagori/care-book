// Shared coverage (admin + staff, desktop + mobile) for the appointment-count header on the patient
// detail Appts tab. Uses shared "Clinic" appointments so the count is identical for both roles, giving
// an exact assertion that holds under every project.

import { AppointmentForm } from '../pages/appointment-form'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'

// S-21: booking from a patient's Appts tab preselects them and comes back to their profile.
test('Book Appointment from the patient Appts tab preselects the patient and returns to the profile', async ({ page, factory }) => {
  const guards = attachErrorGuards(page, { expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }] })
  const patient = await factory.createPatient()
  const sharedType = await factory.findAppointmentType(true)
  const date = clinicDate(76)
  const notes = factory.uniqueName('from-patient-tab')
  factory.watchUiAppointments({ patientId: patient.id, notes })

  await page.goto(`/patients/${patient.id}?tab=appointments`)
  await expect(page.getByText('No appointments yet.', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Book Appointment', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/schedule/new\\?patient_id=${patient.id}&from=`))
  await expect(page.getByLabel('Patient *', { exact: true })).toHaveValue(patient.name as string)

  const form = new AppointmentForm(page, sharedType.name)
  await page.getByLabel('Date *', { exact: true }).fill(date)
  await page.getByLabel('Time *', { exact: true }).fill('08:40')
  await form.field('notes').fill(notes)
  await form.chooseType(sharedType.name)
  await page.getByRole('button', { name: 'Book Appointment', exact: true }).click()
  await expect(page).toHaveURL(`/patients/${patient.id}`)

  const rows = await factory.findAppointments({ patientId: patient.id, notes })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ date, time: '08:40:00' })
  await page.getByRole('tab', { name: 'Appts', exact: true }).click()
  await expect(page.getByTestId('appointment-count')).toHaveText('1 appointment')
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('patient Appts tab shows the total appointment count', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  // Three shared sessions — visible to staff and admin alike, so the count is deterministic per role.
  await factory.createAppointment({ patientId: patient.id, date: clinicDate(-2), time: '09:00' })
  await factory.createAppointment({ patientId: patient.id, date: clinicDate(-1), time: '10:00' })
  await factory.createAppointment({ patientId: patient.id, date: clinicDate(0), time: '11:00' })

  await page.goto(`/patients/${patient.id}?tab=appointments`)

  const count = page.getByTestId('appointment-count')
  await expect(count).toBeVisible()
  await expect(count).toHaveText('3 appointments')

  await guards.assertClean()
})

test('patient Appts count excludes cancelled sessions but still lists them', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  // Two active sessions plus one cancelled — the cancelled one stays in the list but is not counted.
  await factory.createAppointment({ patientId: patient.id, date: clinicDate(-2), time: '09:00', status: 'scheduled' })
  await factory.createAppointment({ patientId: patient.id, date: clinicDate(-1), time: '10:00', status: 'completed' })
  await factory.createAppointment({ patientId: patient.id, date: clinicDate(0), time: '11:00', status: 'cancelled' })

  await page.goto(`/patients/${patient.id}?tab=appointments`)

  const count = page.getByTestId('appointment-count')
  await expect(count).toBeVisible()
  await expect(count).toHaveText('2 appointments')

  // The cancelled session is still rendered in the list even though it is not counted.
  await expect(page.getByText('cancelled', { exact: true })).toBeVisible()

  await guards.assertClean()
})
