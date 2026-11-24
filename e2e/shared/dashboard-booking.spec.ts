// S-20: booking from the dashboard's "New appointment" dialog (desktop header button) and its
// phone twin ("New appt" in the quick-action grid). Admin + staff, desktop + mobile.

import type { Page, TestInfo } from '@playwright/test'
import { AppointmentForm } from '../pages/appointment-form'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect, type E2EFactory } from '../support/factories'
import { isMobileProject } from '../support/mobile'

function guardsFor(page: Page) {
  return attachErrorGuards(page, { expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }] })
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function openDashboardDialog(page: Page, factory: E2EFactory, testInfo: TestInfo) {
  const trigger = page.getByRole('button', { name: isMobileProject(testInfo) ? 'New appt' : 'New appointment', exact: true })
  await expect(trigger).toBeVisible()
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'New Appointment' })
  await expect(dialog.getByLabel('Patient *', { exact: true })).toBeVisible()
  const sharedType = await factory.findAppointmentType(true)
  return { dialog, form: new AppointmentForm(page, sharedType.name, dialog) }
}

test('books an appointment from the dashboard dialog and lists it in today\'s schedule', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const patient = await factory.createPatient()
  const notes = factory.uniqueName('dashboard-booking')
  const today = clinicDate()
  factory.watchUiAppointments({ patientId: patient.id, notes })

  await page.goto('/')
  const { dialog, form } = await openDashboardDialog(page, factory, testInfo)
  // The dialog books for the dashboard's day.
  await expect(dialog.getByLabel('Date *', { exact: true })).toHaveValue(today)
  await form.fill({ patientName: patient.name as string, date: today, time: '22:10', notes })
  await dialog.getByRole('button', { name: 'Book Appointment', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Appointment booked', { exact: true }).filter({ visible: true }).first()).toBeVisible()

  const rows = await factory.findAppointments({ patientId: patient.id, notes })
  expect(rows).toHaveLength(1)
  // Status is left out: after 22:10 clinic time the same booking is (correctly) saved as completed.
  expect(rows[0]).toMatchObject({ date: today, time: '22:10:00' })
  await expect(page.getByRole('link', { name: new RegExp(escape(patient.name as string)) }).filter({ visible: true }).first()).toBeVisible()
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('G-17b: a patient created inline from the dashboard dialog can be picked when the dialog is reopened', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const name = factory.uniqueName('dashboard-inline')
  factory.watchUiPatient(name)
  const today = clinicDate()

  await page.goto('/')
  const first = await openDashboardDialog(page, factory, testInfo)
  await first.form.fill({ patientName: name, date: today, time: '22:20', newPatient: { phone: factory.uniqueMobile() } })
  await first.dialog.getByRole('button', { name: 'Book Appointment', exact: true }).click()
  await expect(first.dialog).toBeHidden()
  await expect.poll(async () => (await factory.findPatientByName(name))?.name).toBe(name)

  const second = await openDashboardDialog(page, factory, testInfo)
  await second.dialog.getByLabel('Patient *', { exact: true }).fill(name)
  await expect(second.dialog.getByRole('button', { name, exact: true })).toBeVisible()
  await expect(second.dialog.getByRole('button', { name: `Create new patient: "${name}"`, exact: true })).toHaveCount(0)
  await guards.assertClean()
})
