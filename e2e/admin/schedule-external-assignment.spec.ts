// S-29: an admin books an appointment for External Staff the patient is shared with (desktop +
// mobile). The label must never be blank, including for an External Staff login with no name and
// no email (G-2), and a grant revoked while the form is open must be refused and reset the picker.

import type { Page } from '@playwright/test'
import { AppointmentForm } from '../pages/appointment-form'
import { CLINIC_A, EXTERNAL } from '../support/accounts'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect, type E2EFactory } from '../support/factories'
import { formatMobileNumber } from '../../src/lib/auth/mobile-number'
import { EXTERNAL_ASSIGNMENT_ACCESS_MESSAGE } from '../../src/lib/appointments/assignment'

function guardsFor(page: Page) {
  return attachErrorGuards(page, { expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }] })
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** "<label> (External Staff)": the visible label plus the tag's screen-reader text. */
function externalOption(label: string) {
  return new RegExp(`^${escape(label)}\\s*\\(External Staff\\)$`)
}

async function bookForExternal(page: Page, factory: E2EFactory, input: { patientName: string; label: string; date: string; time: string; notes: string }) {
  const sharedType = await factory.findAppointmentType(true)
  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  await form.fill({ patientName: input.patientName, date: input.date, time: input.time, notes: input.notes })
  // The External Staff group loads per patient; wait for it before opening the picker.
  await expect(page.getByLabel('Assigned Staff', { exact: true })).toBeVisible()
  await page.getByLabel('Assigned Staff', { exact: true }).click()
  const option = page.getByRole('option', { name: externalOption(input.label) })
  await expect(option).toBeVisible()
  await expect(page.getByRole('option', { name: /^\s*\(External Staff\)$/ }), 'an External Staff option with no label').toHaveCount(0)
  await option.click()
  await form.submitAndExpectBooked()
}

async function expectLabelledEverywhere(page: Page, input: { appointmentId: string; date: string; patientName: string; label: string }) {
  await page.goto(`/schedule?date=${input.date}`)
  const chip = page.getByRole('link', { name: new RegExp(escape(input.patientName)) }).filter({ visible: true })
  await expect(chip).toBeVisible()
  await expect(chip).toContainText(input.label === 'External Staff' ? 'External Staff' : `${input.label} · External Staff`)
  await expect(chip).toHaveAttribute('title', /\S/)
  await expectNoLeakedNulls(page)

  await page.goto(`/schedule/${input.appointmentId}`)
  await expect(page.getByText(input.label, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expectNoLeakedNulls(page)
}

test('books External Staff the patient is shared with and labels the chip and detail', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const patient = await factory.createPatient()
  const external = await factory.findProfileByEmail(EXTERNAL.email)
  await factory.shareWithExternal(patient.id, [external.id])
  const label = external.full_name || external.email
  const date = clinicDate(121)
  const notes = factory.uniqueName('external-assigned')
  factory.watchUiAppointments({ patientId: patient.id, notes })

  await bookForExternal(page, factory, { patientName: patient.name as string, label, date, time: '10:05', notes })

  const rows = await factory.findAppointments({ patientId: patient.id, notes })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ external_profile_id: external.id, assigned_to: null, external_staff_id: null })
  await expectLabelledEverywhere(page, { appointmentId: rows[0].id, date, patientName: patient.name as string, label })
  await guards.assertClean()
})

test('an External Staff login with no name and no email is offered by its mobile number and never shows blank', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const patient = await factory.createPatient()
  const external = await factory.createAuthUser({ clinicId: CLINIC_A.id, role: 'external_staff', email: null, fullName: null })
  await factory.shareWithExternal(patient.id, [external.id])
  const date = clinicDate(122)
  const notes = factory.uniqueName('nameless-external')
  factory.watchUiAppointments({ patientId: patient.id, notes })

  // G-2: the picker showed only the "EXT" tag for this account.
  await bookForExternal(page, factory, {
    patientName: patient.name as string, label: formatMobileNumber(external.mobileNumber), date, time: '10:15', notes,
  })

  const rows = await factory.findAppointments({ patientId: patient.id, notes })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ external_profile_id: external.id })
  // The schedule and detail only know the profile's name and email, so they fall back to the role.
  await expectLabelledEverywhere(page, { appointmentId: rows[0].id, date, patientName: patient.name as string, label: 'External Staff' })
  await guards.assertClean()
})

test('a grant revoked while the form is open is refused and resets the assignee picker', async ({ page, factory }) => {
  const guards = attachErrorGuards(page, { expectedHttpErrors: [
    { pathname: '/api/telemetry', status: 429 },
    // EXTERNAL_ASSIGNMENT_UNAVAILABLE is answered 400 (booking-handler.ts).
    { pathname: '/api/appointments/bookings', status: 400 },
  ] })
  const patient = await factory.createPatient()
  const external = await factory.findProfileByEmail(EXTERNAL.email)
  await factory.shareWithExternal(patient.id, [external.id])
  const sharedType = await factory.findAppointmentType(true)
  const label = external.full_name || external.email
  const date = clinicDate(123)
  const notes = factory.uniqueName('revoked-external')
  factory.watchUiAppointments({ patientId: patient.id, notes })

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  await form.fill({ patientName: patient.name as string, date, time: '10:25', notes })
  await form.chooseAssignee(externalOption(label))
  await expect(page.getByLabel('Assigned Staff', { exact: true })).toContainText(label)

  // Another admin revokes the grant before this one taps Book.
  await factory.shareWithExternal(patient.id, [])
  await page.getByRole('button', { name: 'Book Appointment', exact: true }).click()

  const notifications = page.getByRole('region', { name: 'Notifications (F8)' })
  await expect(notifications).toContainText(EXTERNAL_ASSIGNMENT_ACCESS_MESSAGE)
  await expect(page).toHaveURL(/\/schedule\/new/)
  // The assignment is dropped and the External Staff list reloads without the revoked account.
  await expect(page.getByLabel('Assigned Staff', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Book Appointment', exact: true })).toBeEnabled()
  expect(await factory.findAppointments({ patientId: patient.id, notes })).toEqual([])
  await guards.assertClean()
})
