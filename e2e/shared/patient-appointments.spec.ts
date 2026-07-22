// Shared coverage (admin + staff, desktop + mobile) for the appointment-count header on the patient
// detail Appts tab. Uses shared "Clinic" appointments so the count is identical for both roles, giving
// an exact assertion that holds under every project.

import { attachErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'

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
