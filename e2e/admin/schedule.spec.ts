import { AppointmentForm } from '../pages/appointment-form'
import { attachErrorGuards } from '../support/assertions'
import { STAFF2 } from '../support/accounts'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'

test('books a restricted appointment assigned to an internal staff member', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const sharedType = await factory.findAppointmentType(true)
  const privateType = await factory.findAppointmentType(false)
  const staff = await factory.findProfileByEmail(STAFF2.email)
  const date = clinicDate(75)
  const notes = factory.uniqueName('private-booking')
  const staffLabel = `${staff.full_name || staff.email} · ${staff.role}`
  factory.watchUiAppointments({ patientId: patient.id, notes })

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  await form.fill({
    patientName: patient.name as string,
    date,
    time: '13:20',
    durationMinutes: '60',
    notes,
    appointmentTypeName: privateType.name,
    assignedStaffLabel: staffLabel,
  })
  await form.submitAndExpectBooked()

  const rows = await factory.findAppointments({ patientId: patient.id, notes })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    date,
    time: '13:20:00',
    appointment_type_id: privateType.id,
    type_is_shared: false,
    assigned_to: staff.id,
  })
  await page.goto(`/schedule/${rows[0].id}`)
  await expect(page.getByText(staff.full_name || staff.email, { exact: true })).toBeVisible()
  await guards.assertClean()
})
