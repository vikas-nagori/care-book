// Staff never see fees or External Staff sharing; their bookings are priced by the database.

import { AppointmentForm } from '../pages/appointment-form'
import { STAFF } from '../support/accounts'
import { attachErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'

test("staff bookings take the patient's last fee for the type without showing it", async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const staff = await factory.findProfileByEmail(STAFF.email)
  const patient = await factory.createPatient()
  const privateType = await factory.findAppointmentType(false)
  await factory.createAppointment({
    patientId: patient.id as string, appointmentTypeId: privateType.id, type: privateType.name,
    date: clinicDate(-5), fee: 1450, assigned_to: staff.id,
  })
  const notes = factory.uniqueName('staff-priced-booking')
  factory.watchUiAppointments({ patientId: patient.id as string, notes })

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, privateType.name)
  await form.fill({
    patientName: patient.name as string,
    date: clinicDate(80),
    time: '14:10',
    durationMinutes: '45',
    notes,
    appointmentTypeName: privateType.name,
  })
  await expect(page.getByLabel('Session Fee (₹)', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Assigned Staff', { exact: true })).toContainText(staff.full_name || staff.email)
  await form.submitAndExpectBooked()

  const rows = await factory.findAppointments({ patientId: patient.id as string, notes })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ assigned_to: staff.id, fee: 1450, payment_status: 'unpaid' })
  await guards.assertClean()
})

test('staff cannot see or change External Staff sharing on a patient', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()

  await page.goto(`/patients/${patient.id}`)
  await expect(page.getByRole('link', { name: 'Edit', exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByText('External Staff access', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save access', exact: true })).toHaveCount(0)
  await guards.assertClean()
})
