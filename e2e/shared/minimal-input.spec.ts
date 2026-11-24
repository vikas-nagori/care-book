// Minimal-input coverage (admin + staff, desktop + mobile).
//
// Every other spec fills every field, which is how a NULL email reached production and crashed
// /settings (2026-11-24). Here each form is submitted with ONLY its required fields, and then
// every screen that renders the record is visited: it must not crash (attachErrorGuards) and
// must not leak the NULLs as "null"/"undefined" text or `tel:null` links (expectNoLeakedNulls).
// When a form gains an optional field, leave it blank here.

import type { Page } from '@playwright/test'
import { AppointmentForm } from '../pages/appointment-form'
import { PatientForm } from '../pages/patient-form'
import { SessionNoteForm } from '../pages/session-note-form'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'

function guardsFor(page: Page) {
  // Rapid matrix runs share a user across devices and can reach the intentional telemetry budget.
  return attachErrorGuards(page, { expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }] })
}

async function visitEveryPatientTab(page: Page, patientId: string) {
  await page.goto(`/patients/${patientId}`)
  for (const tab of ['Profile', 'Appts', 'Plans', 'Billing']) {
    const trigger = page.getByRole('tab', { name: tab, exact: true })
    // Billing is admin-only; the other tabs are always there.
    if (tab === 'Billing' && (await trigger.count()) === 0) continue
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-selected', 'true')
    await expectNoLeakedNulls(page)
  }
}

test('a patient saved with only a name renders on every patient screen', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const name = factory.uniqueName('name-only-patient')
  factory.watchUiPatient(name)

  await page.goto('/patients/new')
  const form = new PatientForm(page)
  await form.fill({ name })
  await form.submitCreate()

  const patient = await factory.findPatientByName(name)
  expect(patient).toMatchObject({
    name,
    phone: null,
    email: null,
    dob: null,
    age_years: null,
    age_recorded_on: null,
    gender: null,
    address: null,
    medical_history: null,
    notes: null,
  })

  await page.getByPlaceholder('Search by name or phone…').fill(name)
  await expect(page.getByRole('link', { name: new RegExp(name) }).filter({ visible: true })).toBeVisible()
  await expectNoLeakedNulls(page)

  await visitEveryPatientTab(page, patient!.id)
  await page.goto(`/patients/${patient!.id}/edit`)
  await expect(page.getByLabel('Name *', { exact: true })).toHaveValue(name)
  await expect(page.getByLabel('Phone', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Age (years)', { exact: true })).toHaveValue('')
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('a patient created inline while booking, with the age left blank, renders on every patient screen', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const name = factory.uniqueName('inline-no-age')
  factory.watchUiPatient(name)
  const sharedType = await factory.findAppointmentType(true)
  const date = clinicDate(0)

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  await form.fill({ patientName: name, date, time: '21:40', newPatient: { phone: `9${Date.now().toString().slice(-9)}` } })
  await form.submitAndExpectBooked()

  await expect.poll(async () => (await factory.findPatientByName(name))?.name).toBe(name)
  const patient = await factory.findPatientByName(name)
  expect(patient).toMatchObject({ dob: null, age_years: null, age_recorded_on: null, email: null, gender: null })

  await page.goto('/patients')
  await page.getByPlaceholder('Search by name or phone…').fill(name)
  await expect(page.getByRole('link', { name: new RegExp(name) }).filter({ visible: true })).toBeVisible()
  await expectNoLeakedNulls(page)
  await visitEveryPatientTab(page, patient!.id)
  await expect(page.getByTestId('patient-age')).toHaveCount(0)
  await guards.assertClean()
})

test('an appointment booked with only required fields renders on schedule, detail and dashboard', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const patient = await factory.createPatient({ phone: null })
  const sharedType = await factory.findAppointmentType(true)
  const date = clinicDate(0)

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  await form.fill({ patientName: patient.name as string, date, time: '21:35' })
  await form.submitAndExpectBooked()

  const [appointment] = await factory.findAppointments({ patientId: patient.id, date })
  expect(appointment).toMatchObject({ notes: null, duration_minutes: 45, time: '21:35:00' })

  await page.goto(`/schedule?date=${date}`)
  await expect(page.getByRole('link', { name: new RegExp(patient.name as string) }).filter({ visible: true }).first()).toBeVisible()
  await expectNoLeakedNulls(page)

  await page.goto(`/schedule/${appointment.id}`)
  await expect(page.getByText(patient.name as string, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expectNoLeakedNulls(page)

  await page.goto('/')
  await expectNoLeakedNulls(page)

  await visitEveryPatientTab(page, patient.id)
  await guards.assertClean()
})

test('an all-blank session note saves and renders', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const patient = await factory.createPatient({ phone: null })
  const appointment = await factory.createAppointment({
    patientId: patient.id,
    date: clinicDate(-46),
    time: '14:20',
    status: 'completed',
    notes: null,
  })
  factory.watchUiSessionNote(appointment.id)

  await page.goto(`/schedule/${appointment.id}`)
  await page.getByRole('button', { name: 'Add Notes', exact: true }).click()
  const form = new SessionNoteForm(page)
  await form.fill({})
  await form.save('Notes saved')

  await page.reload()
  await expect(page.getByRole('button', { name: 'Edit Notes', exact: true })).toBeVisible()
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('a treatment plan with only its required fields renders on the Plans tab', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const patient = await factory.createPatient({ phone: null })
  const diagnosis = factory.uniqueName('diagnosis-only')

  await page.goto(`/patients/${patient.id}`)
  await page.getByRole('tab', { name: 'Plans', exact: true }).click()
  await page.getByRole('button', { name: 'Add Plan', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New Treatment Plan' })
  // The plan form's labels have no htmlFor, so drive the inputs by name. Goals and Expected End
  // stay blank; Start Date defaults to today.
  await dialog.locator('input[name="diagnosis"]').fill(diagnosis)
  await dialog.locator('button[type="submit"]').click()
  await expect(dialog).toBeHidden()

  await page.reload()
  await page.getByRole('tab', { name: 'Plans', exact: true }).click()
  await expect(page.getByText(diagnosis, { exact: true }).filter({ visible: true })).toBeVisible()
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('a reminder with only a title and date renders on the schedule and dashboard', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const title = factory.uniqueName('title-only-reminder')
  const date = clinicDate(0)
  factory.watchUiReminder(title)

  await page.goto(`/schedule?date=${date}`)
  await page.getByRole('button', { name: 'Add reminder', exact: true }).filter({ visible: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('What needs following up?').fill(title)
  await dialog.getByRole('button', { name: 'Save reminder', exact: true }).click()
  await expect(dialog).toBeHidden()

  const card = page.getByRole('button').filter({ hasText: title })
  await expect(card).toBeVisible()
  await expectNoLeakedNulls(page)
  await card.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectNoLeakedNulls(page)
  await page.keyboard.press('Escape')

  await page.goto('/')
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})
