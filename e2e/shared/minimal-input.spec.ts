// Minimal-input coverage (admin + staff, desktop + mobile).
//
// Every other spec fills every field, which is how a NULL email reached production and crashed
// /settings (2026-11-24). Here each form is submitted with ONLY its required fields, and then
// every screen that renders the record is visited: it must not crash (attachErrorGuards) and
// must not leak the NULLs as "null"/"undefined" text or `tel:null` links (expectNoLeakedNulls).
// When a form gains an optional field, leave it blank here.

import type { Locator, Page, TestInfo } from '@playwright/test'
import { AppointmentForm } from '../pages/appointment-form'
import { PatientForm } from '../pages/patient-form'
import { SessionNoteForm } from '../pages/session-note-form'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate, wholeYearsSince } from '../support/clinic-date'
import { test, expect } from '../support/factories'
import { CLINIC_A, EXTERNAL } from '../support/accounts'
import { formatMobileNumber } from '../../src/lib/auth/mobile-number'
import { AppointmentDetail } from '../pages/appointment-detail'
import { isSupabaseRequest } from '../support/fault-injection'
import { IOS_TAG, isMobileProject, projectRole } from '../support/mobile'

function guardsFor(page: Page) {
  // Rapid matrix runs share a user across devices and can reach the intentional telemetry budget.
  return attachErrorGuards(page, { expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }] })
}

async function visitEveryPatientTab(page: Page, patientId: string, testInfo: TestInfo) {
  await page.goto(`/patients/${patientId}`)
  // Billing is admin-only: it must be there for admins and absent for staff, never just skipped.
  const billing = page.getByRole('tab', { name: 'Billing', exact: true })
  if (projectRole(testInfo) === 'admin') await expect(billing).toBeVisible()
  else await expect(billing).toHaveCount(0)
  for (const tab of projectRole(testInfo) === 'admin' ? ['Profile', 'Appts', 'Plans', 'Billing'] : ['Profile', 'Appts', 'Plans']) {
    const trigger = page.getByRole('tab', { name: tab, exact: true })
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-selected', 'true')
    await expectNoLeakedNulls(page)
  }
}

/**
 * Every screen that renders one appointment: the day view, the week view (desktop only: phones
 * have no Week toggle), the detail page with its Edit dialog opened, and the dashboard.
 */
async function visitEveryAppointmentScreen(
  page: Page,
  testInfo: TestInfo,
  input: { appointmentId: string; date: string; patientName: string },
) {
  const chip = page.locator(`a[href="/schedule/${input.appointmentId}"]`).filter({ visible: true })
  await page.goto(`/schedule?date=${input.date}`)
  await expect(chip).toBeVisible()
  await expectNoLeakedNulls(page)
  if (!isMobileProject(testInfo)) {
    await page.getByRole('button', { name: 'Week', exact: true }).click()
    await expect(chip).toBeVisible()
    await expectNoLeakedNulls(page)
  }

  await page.goto(`/schedule/${input.appointmentId}`)
  await expect(page.getByText(input.patientName, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expectNoLeakedNulls(page)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Edit Appointment' })
  await expect(edit).toBeVisible()
  await expectNoLeakedNulls(page, { scope: edit })
  await page.keyboard.press('Escape')
  await expect(edit).toBeHidden()

  await page.goto('/')
  if (input.date === clinicDate()) {
    await expect(page.locator(`a[href="/schedule/${input.appointmentId}"]`).filter({ visible: true }).first()).toBeVisible()
  }
  await expectNoLeakedNulls(page)
}

/** Back on the Profile tab, where the age would render, with its content mounted. */
async function openProfileTab(page: Page, patientName: string) {
  const profile = page.getByRole('tab', { name: 'Profile', exact: true })
  await profile.click()
  await expect(profile).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel').filter({ visible: true })).toBeVisible()
  await expect(page.getByText(patientName, { exact: true }).filter({ visible: true }).first()).toBeVisible()
}

test('a patient saved with only a name renders on every patient screen', { tag: IOS_TAG }, async ({ page, factory }, testInfo) => {
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

  await visitEveryPatientTab(page, patient!.id, testInfo)
  await page.goto(`/patients/${patient!.id}/edit`)
  await expect(page.getByLabel('Name *', { exact: true })).toHaveValue(name)
  await expect(page.getByLabel('Phone', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Age (years)', { exact: true })).toHaveValue('')
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('a patient created inline while booking, with the age left blank, renders on every patient screen', { tag: IOS_TAG }, async ({ page, factory }, testInfo) => {
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
  // S-5: the booking it came with renders on the appointment's own screens too.
  const [appointment] = await factory.findAppointments({ patientId: patient!.id, date })
  expect(appointment).toMatchObject({ notes: null, time: '21:40:00' })
  await visitEveryAppointmentScreen(page, testInfo, { appointmentId: appointment.id, date, patientName: name })

  await page.goto('/patients')
  await page.getByPlaceholder('Search by name or phone…').fill(name)
  await expect(page.getByRole('link', { name: new RegExp(name) }).filter({ visible: true })).toBeVisible()
  await expectNoLeakedNulls(page)
  await visitEveryPatientTab(page, patient!.id, testInfo)
  await openProfileTab(page, name)
  await expect(page.getByTestId('patient-age')).toHaveCount(0)
  await guards.assertClean()
})

/** The patient's row on /patients, found through the search box. */
async function searchPatientList(page: Page, name: string) {
  await page.goto('/patients')
  await page.getByPlaceholder('Search by name or phone…').fill(name)
  const row = page.getByRole('link', { name: new RegExp(name) }).filter({ visible: true })
  await expect(row).toBeVisible()
  return row
}

/** No phone, email or age on the Profile tab, and no link to call or mail. */
async function expectBlankContact(page: Page, name: string) {
  await openProfileTab(page, name)
  await expect(page.getByText('No phone number', { exact: true })).toBeVisible()
  await expect(page.getByTestId('patient-age')).toHaveCount(0)
  await expect(page.locator('a[href^="tel:"], a[href^="mailto:"]')).toHaveCount(0)
  await expect(page.getByRole('link', { name: `Call ${name}`, exact: true })).toHaveCount(0)
}

// PA-1
test('a fully filled patient edited back to a name clears every optional column and renders everywhere', { tag: IOS_TAG }, async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const name = factory.uniqueName('edit-to-blank')
  factory.watchUiPatient(name)

  await page.goto('/patients/new')
  const form = new PatientForm(page)
  await form.fill({
    name,
    phone: factory.uniqueMobile(),
    email: `${factory.token}-edit-to-blank@carebook.test`,
    age: '41',
    gender: 'Female',
    address: `${name} address`,
    medicalHistory: `${name} history`,
    notes: `${name} notes`,
  })
  await form.submitCreate()
  await expect.poll(async () => (await factory.findPatientByName(name))?.age_years).toBe(41)
  const patient = (await factory.findPatientByName(name))!

  await page.goto(`/patients/${patient.id}/edit`)
  for (const field of ['phone', 'email', 'age', 'address', 'medicalHistory', 'notes'] as const) await form.clear(field)
  await form.submitUpdate()

  await expect.poll(async () => (await factory.findPatientByName(name))?.phone).toBeNull()
  // Gender is a select with no "none" option, so it keeps its value.
  expect(await factory.findPatientByName(name)).toMatchObject({
    phone: null, email: null, dob: null, age_years: null, age_recorded_on: null,
    gender: 'female', address: null, medical_history: null, notes: null,
  })

  const row = await searchPatientList(page, name)
  await expect(row).not.toContainText(/\d+ y\b/)
  await expectNoLeakedNulls(page)
  await visitEveryPatientTab(page, patient.id, testInfo)
  await expectBlankContact(page, name)
  await expectNoLeakedNulls(page)

  await page.goto(`/patients/${patient.id}/edit`)
  await expect(page.locator('input#name')).toHaveValue(name)
  for (const label of ['Phone', 'Email', 'Age (years)', 'Address', 'Medical History', 'Notes']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('')
  }
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

// PA-2
test('re-saving a name-only patient unchanged writes no age and leaves every optional column empty', { tag: IOS_TAG }, async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const patient = await factory.createPatient({ phone: null })

  await page.goto(`/patients/${patient.id}/edit`)
  await expect(page.locator('input#name')).toHaveValue(patient.name)
  const update = page.waitForRequest((request) => isSupabaseRequest(request, { resource: 'rest/v1/patients', method: 'PATCH' }))
  await new PatientForm(page).submitUpdate()
  const body = (await update).postDataJSON() as Record<string, unknown>
  // An unchanged (blank) age writes no age keys at all, and the date of birth is never sent.
  expect(Object.keys(body)).not.toContain('age_years')
  expect(Object.keys(body)).not.toContain('age_recorded_on')
  expect(Object.keys(body)).not.toContain('dob')
  expect(body).toMatchObject({
    name: patient.name, phone: null, email: null, gender: null, address: null,
    medical_history: null, notes: null, referral_source: null,
  })
  expect(await factory.findPatientByName(patient.name)).toMatchObject({
    phone: null, email: null, dob: null, age_years: null, age_recorded_on: null, gender: null,
    address: null, medical_history: null, notes: null, referral_source: null,
  })

  await searchPatientList(page, patient.name)
  await expectNoLeakedNulls(page)
  await visitEveryPatientTab(page, patient.id, testInfo)
  await expectBlankContact(page, patient.name)
  await guards.assertClean()
})

// PA-3 (decision D4a, change C-1): emptying Age deletes the legacy dob too, or patientAge() would
// fall back to it and the age would come straight back.
test('clearing Age on a patient with a legacy date of birth removes the age and the date of birth', { tag: IOS_TAG }, async ({ page, factory, browser }, testInfo) => {
  const guards = guardsFor(page)
  const dob = '1980-05-05'
  const patient = await factory.createPatient({ dob, phone: null })
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(-3), time: '10:10' })
  const external = await factory.findProfileByEmail(EXTERNAL.email)
  await factory.shareWithExternal(patient.id, [external.id])

  await page.goto(`/patients/${patient.id}/edit`)
  await expect(page.getByLabel('Age (years)', { exact: true })).toHaveValue(String(wholeYearsSince(dob)))
  const form = new PatientForm(page)
  await form.clear('age')
  await form.submitUpdate()
  await expect.poll(async () => (await factory.findPatientByName(patient.name))?.dob ?? null).toBeNull()
  expect(await factory.findPatientByName(patient.name)).toMatchObject({ dob: null, age_years: null, age_recorded_on: null })

  // No age on the list, the detail, the edit prefill or the appointment.
  const row = await searchPatientList(page, patient.name)
  await expect(row).not.toContainText(/\d+ y\b/)
  await visitEveryPatientTab(page, patient.id, testInfo)
  await openProfileTab(page, patient.name)
  await expect(page.getByTestId('patient-age')).toHaveCount(0)
  await page.goto(`/patients/${patient.id}/edit`)
  await expect(page.getByLabel('Age (years)', { exact: true })).toHaveValue('')
  await page.goto(`/schedule/${appointment.id}`)
  await expect(page.getByText(patient.name, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByText(/\b\d+ years?\b/)).toHaveCount(0)
  await expectNoLeakedNulls(page)

  // Nor in the External Staff view of the shared patient.
  const externalContext = await browser.newContext({ storageState: EXTERNAL.storageState })
  try {
    const externalPage = await externalContext.newPage()
    const externalGuards = guardsFor(externalPage)
    await externalPage.goto('/external/patients')
    await externalPage.getByPlaceholder('Search by name or phone…').fill(patient.name)
    await externalPage.getByRole('button', { name: new RegExp(patient.name) }).filter({ visible: true }).click()
    const profile = externalPage.getByRole('dialog', { name: patient.name, exact: true })
    await expect(profile).toBeVisible()
    await expect(profile.getByText(/\b\d+ years?\b/)).toHaveCount(0)
    await expectNoLeakedNulls(externalPage, { scope: profile })
    await externalGuards.assertClean()
  } finally {
    await externalContext.close()
  }
  await guards.assertClean()
})

// PA-3, the other side of D4a: only an emptied Age may delete the date of birth.
test('an edit that leaves the age alone, or corrects it, never touches a legacy date of birth', { tag: IOS_TAG }, async ({ page, factory }) => {
  const guards = guardsFor(page)
  const dob = '1975-08-20'
  const patient = await factory.createPatient({ dob, phone: null })
  const form = new PatientForm(page)

  // Phone only.
  const phone = factory.uniqueMobile()
  await page.goto(`/patients/${patient.id}/edit`)
  await page.getByLabel('Phone', { exact: true }).fill(phone)
  await form.submitUpdate()
  await expect.poll(async () => (await factory.findPatientByName(patient.name))?.phone).toBe(phone)
  expect(await factory.findPatientByName(patient.name)).toMatchObject({ dob, age_years: null, age_recorded_on: null })

  // A corrected age is stored beside the date of birth.
  const corrected = wholeYearsSince(dob) + 2
  await page.goto(`/patients/${patient.id}/edit`)
  await page.getByLabel('Age (years)', { exact: true }).fill(String(corrected))
  await form.submitUpdate()
  await expect.poll(async () => (await factory.findPatientByName(patient.name))?.age_years).toBe(corrected)
  expect(await factory.findPatientByName(patient.name)).toMatchObject({ dob, age_recorded_on: clinicDate() })
  await page.goto(`/patients/${patient.id}`)
  await expect(page.getByTestId('patient-age')).toHaveText(`Age ${corrected} years`)
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

// PA-4
test('a patient referred by a doctor with no specialty or address renders and saves', { tag: IOS_TAG }, async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const doctor = await factory.createDoctor()
  const patient = await factory.createPatient({ phone: null, referral_source: 'doctor', referred_by_doctor_id: doctor.id })

  await page.goto(`/patients/${patient.id}`)
  await expect(page.getByText(doctor.name, { exact: true })).toHaveText(doctor.name)
  await expect(page.getByText(`${doctor.name} ·`)).toHaveCount(0)
  await expectNoLeakedNulls(page)

  const notes = factory.uniqueName('referred notes')
  await page.goto(`/patients/${patient.id}/edit`)
  await expect(page.getByLabel('Referring Doctor', { exact: true })).toHaveText(doctor.name)
  await expectNoLeakedNulls(page)
  await page.getByLabel('Notes', { exact: true }).fill(notes)
  await new PatientForm(page).submitUpdate()
  await expect.poll(async () => (await factory.findPatientByName(patient.name))?.notes).toBe(notes)
  expect(await factory.findPatientByName(patient.name)).toMatchObject({ referral_source: 'doctor', referred_by_doctor_id: doctor.id })
  await visitEveryPatientTab(page, patient.id, testInfo)
  await guards.assertClean()
})

// PA-4. G-13: the referral picker demands a referrer before the form may save, so a patient whose
// referring patient or doctor was deleted (source kept, id set NULL) cannot be edited at all
// until the source is changed.
test('G-13: a patient whose referrer was deleted renders and can still be saved', { tag: IOS_TAG }, async ({ page, factory }, testInfo) => {
  test.fail(true, 'G-13: a dangling referral blocks every save of the patient')
  const guards = guardsFor(page)
  const dangling = [
    await factory.createPatient({ phone: null, referral_source: 'patient', referred_by_patient_id: null }),
    await factory.createPatient({ phone: null, referral_source: 'doctor', referred_by_doctor_id: null }),
  ]
  for (const patient of dangling) {
    await visitEveryPatientTab(page, patient.id, testInfo)
    const notes = factory.uniqueName('dangling referral notes')
    await page.goto(`/patients/${patient.id}/edit`)
    await expectNoLeakedNulls(page)
    await page.getByLabel('Notes', { exact: true }).fill(notes)
    await new PatientForm(page).submitUpdate()
    await expect.poll(async () => (await factory.findPatientByName(patient.name))?.notes).toBe(notes)
  }
  await guards.assertClean()
})

test('an appointment booked with only required fields renders on schedule, detail and dashboard', { tag: IOS_TAG }, async ({ page, factory }, testInfo) => {
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

  await visitEveryAppointmentScreen(page, testInfo, { appointmentId: appointment.id, date, patientName: patient.name as string })
  await expectNoLeakedNulls(page)

  await visitEveryPatientTab(page, patient.id, testInfo)
  await guards.assertClean()
})

test('an all-blank session note saves and renders', { tag: IOS_TAG }, async ({ page, factory }) => {
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

test('a treatment plan with only its required fields renders on the Plans tab', { tag: IOS_TAG }, async ({ page, factory }) => {
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

test('a reminder with only a title and date renders on the schedule and dashboard', { tag: IOS_TAG }, async ({ page, factory }) => {
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

// --- Appointment, note and assignee cases (plan 5.2) ---------------------------------------

// S-2: edit-to-blank. Notes back to NULL, a cleared duration back to the 45-minute default.
test('an appointment edited back to no notes and no duration renders on every appointment screen', { tag: IOS_TAG }, async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const patient = await factory.createPatient({ phone: null })
  const date = clinicDate(0)
  const appointment = await factory.createAppointment({ patientId: patient.id, date, time: '06:25', duration_minutes: 60 })
  expect(appointment.notes).not.toBeNull()

  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  const form = await detail.openEdit()
  await form.clear('notes')
  await form.clear('duration')
  await form.submitUpdate()
  await expect(detail.editDialog()).toBeHidden()

  await expect.poll(async () => (await factory.findAppointments({ patientId: patient.id }))[0]?.notes ?? null).toBeNull()
  expect((await factory.findAppointments({ patientId: patient.id }))[0]).toMatchObject({ notes: null, duration_minutes: 45 })
  await expectNoLeakedNulls(page)

  await visitEveryAppointmentScreen(page, testInfo, { appointmentId: appointment.id, date, patientName: patient.name as string })
  await visitEveryPatientTab(page, patient.id, testInfo)
  await guards.assertClean()
})

// S-4: a restricted type booked with "Unassigned" (the form preselects the booker).
test('a restricted appointment booked as Unassigned renders on every appointment screen', { tag: IOS_TAG }, async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const patient = await factory.createPatient({ phone: null })
  const sharedType = await factory.findAppointmentType(true)
  const privateType = await factory.findAppointmentType(false)
  const date = clinicDate(0)

  await page.goto('/schedule/new')
  const form = new AppointmentForm(page, sharedType.name)
  await form.fill({ patientName: patient.name as string, date, time: '21:25', appointmentTypeName: privateType.name, assignedStaffLabel: 'Unassigned' })
  await expect(page.getByLabel('Assigned Staff', { exact: true })).toContainText('Unassigned')
  await form.submitAndExpectBooked()

  const [appointment] = await factory.findAppointments({ patientId: patient.id, date })
  expect(appointment).toMatchObject({ appointment_type_id: privateType.id, type_is_shared: false, assigned_to: null, external_staff_id: null, external_profile_id: null, notes: null })
  await expectNoLeakedNulls(page)
  await visitEveryAppointmentScreen(page, testInfo, { appointmentId: appointment.id, date, patientName: patient.name as string })
  await guards.assertClean()
})

// S-27: a note emptied field by field must not leave an empty card behind.
test('G-17g: a session note cleared of every field leaves no empty Session Notes card', { tag: IOS_TAG }, async ({ page, factory }, testInfo) => {
  testInfo.fail(true, 'G-17g: a blank session note still renders an empty "Session Notes" card')
  const guards = guardsFor(page)
  const patient = await factory.createPatient({ phone: null })
  const appointment = await factory.createAppointment({
    patientId: patient.id, date: clinicDate(-48), time: '14:40', status: 'completed', notes: null,
  })
  await factory.createSessionNote({
    appointmentId: appointment.id,
    subjective: factory.uniqueName('s'), objective: factory.uniqueName('o'), assessment: factory.uniqueName('a'),
    plan: factory.uniqueName('p'), exercises_prescribed: factory.uniqueName('e'),
  })

  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  await expect(detail.notesCard()).toBeVisible()
  const form = await detail.openNotes()
  await form.clearAll()
  await form.save('Notes updated')
  expect((await factory.findSessionNotes(appointment.id))[0]).toMatchObject({
    subjective: null, objective: null, assessment: null, plan: null, exercises_prescribed: null,
  })

  await page.reload()
  await expect(page.getByRole('button', { name: 'Edit Notes', exact: true })).toBeVisible()
  await expectNoLeakedNulls(page)
  await expect(detail.notesCard()).toHaveCount(0)
  await guards.assertClean()
})

test('G-17g: an Objective-only session note renders without a leading separator', { tag: IOS_TAG }, async ({ page, factory }, testInfo) => {
  testInfo.fail(true, 'G-17g: the Session Notes card draws a separator above its first section when Subjective is blank')
  const guards = guardsFor(page)
  const patient = await factory.createPatient({ phone: null })
  const appointment = await factory.createAppointment({
    patientId: patient.id, date: clinicDate(-49), time: '14:50', status: 'completed', notes: null,
  })
  const objective = factory.uniqueName('objective-only')
  await factory.createSessionNote({ appointmentId: appointment.id, objective })

  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  const card = detail.notesCard()
  await expect(card.getByText(objective, { exact: true })).toBeVisible()
  await expectNoLeakedNulls(page)
  // The first thing under the card title is the Objective heading, not a divider line.
  const firstBlock = await card.getByText('Objective', { exact: true }).evaluate((label) => {
    const content = label.parentElement!.parentElement!
    const first = content.firstElementChild
    return first ? { orientation: first.getAttribute('data-orientation'), text: first.textContent } : null
  })
  expect(firstBlock?.orientation ?? null, `first block: ${JSON.stringify(firstBlock)}`).toBeNull()
  await guards.assertClean()
})

// S-30 / G-2: a pending mobile-only Staff invitee has no name or email on their profile yet.
test('a pending mobile-only Staff invitee is never offered as a blank assignee', { tag: IOS_TAG }, async ({ page, factory }, testInfo) => {
  testInfo.skip(projectRole(testInfo) !== 'admin', 'admin books for other staff')
  const guards = guardsFor(page)
  const invitee = await factory.createAuthUser({ clinicId: CLINIC_A.id, role: 'staff', email: null, fullName: null })
  const inviteeName = factory.uniqueName('pending-invitee')
  await factory.createUserInvite({
    clinicId: CLINIC_A.id, email: null, authUserId: invitee.id, fullName: inviteeName, mobileNumber: invitee.mobileNumber,
  })
  const privateType = await factory.findAppointmentType(false)
  const sharedType = await factory.findAppointmentType(true)
  const tagOnly = /^\s*\((Staff|Admin)\)$/

  async function expectNamedOptions(scope?: Locator) {
    const form = new AppointmentForm(page, sharedType.name, scope)
    // The dialog focuses the patient search, whose suggestion list covers the Type select on
    // desktop; a click elsewhere in the dialog closes it.
    if (scope) await scope.getByRole('heading', { name: 'New Appointment' }).click()
    await form.chooseType(privateType.name)
    await (scope ?? page).getByLabel('Assigned Staff', { exact: true }).click()
    // Positive control: the picker is open and lists named staff.
    await expect(page.getByRole('option', { name: /^staff2\s*\(Staff\)$/ })).toBeVisible()
    await expect(page.getByRole('option', { name: tagOnly }), 'an assignee option with only a role tag').toHaveCount(0)
    // Shown by the invite's name, or not offered until they accept: never blank, never a bare number.
    await expect(page.getByRole('option', { name: new RegExp(formatMobileNumber(invitee.mobileNumber)) })).toHaveCount(0)
    await expectNoLeakedNulls(page)
    await page.keyboard.press('Escape')
  }

  await page.goto('/schedule/new')
  await expect(page.getByLabel('Patient *', { exact: true })).toBeVisible()
  await expectNamedOptions()

  await page.goto('/')
  await page.getByRole('button', { name: isMobileProject(testInfo) ? 'New appt' : 'New appointment', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New Appointment' })
  await expect(dialog.getByLabel('Patient *', { exact: true })).toBeVisible()
  await expectNamedOptions(dialog)
  await guards.assertClean()
})
