// The date-strip chips tally the day's workload. Cancelled appointments are not work, so they must
// not inflate the number — a day of wash-outs has to read as a quiet day on both the desktop strip
// and the mobile rolling rail.

import { attachErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'

// The chip's accessible name is `<full date>, N appointment(s)`, identical on both viewports.
function fullDateLabel(date: string) {
  return new Intl.DateTimeFormat('en', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00.000Z`))
}

test('date-strip chip counts scheduled and completed appointments but not cancelled ones', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  // A far-future date nothing else in the suite books, so the chip count is entirely ours.
  const date = clinicDate(140)

  await factory.createAppointment({ patientId: patient.id, date, time: '09:00', status: 'scheduled' })
  await factory.createAppointment({ patientId: patient.id, date, time: '10:00', status: 'completed' })
  await factory.createAppointment({ patientId: patient.id, date, time: '11:00', status: 'cancelled' })
  await factory.createAppointment({ patientId: patient.id, date, time: '12:00', status: 'cancelled' })

  await page.goto(`/schedule?date=${date}`)

  const chip = page
    .getByRole('button', { name: new RegExp(`^${fullDateLabel(date)}, `) })
    .filter({ visible: true })
  await expect(chip).toHaveAttribute('aria-label', `${fullDateLabel(date)}, 2 appointments`)
  await expect(chip).toContainText('·2·')

  await guards.assertClean()
})

test('a day of only cancelled appointments reads as empty on the date strip', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const date = clinicDate(141)

  await factory.createAppointment({ patientId: patient.id, date, time: '09:30', status: 'cancelled' })
  await factory.createAppointment({ patientId: patient.id, date, time: '10:30', status: 'cancelled' })

  await page.goto(`/schedule?date=${date}`)

  const chip = page
    .getByRole('button', { name: new RegExp(`^${fullDateLabel(date)}, `) })
    .filter({ visible: true })
  await expect(chip).toHaveAttribute('aria-label', `${fullDateLabel(date)}, no appointments`)
  await expect(chip).not.toContainText('·2·')

  await guards.assertClean()
})
