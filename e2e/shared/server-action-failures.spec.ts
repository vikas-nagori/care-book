// Server-action failures on the schedule, reminders and dashboard (plan S-12..S-17).
//
// Each control is the same DOM for admin and staff, so the write cases run on the phone projects
// only (decision D2: mobile is never the one dropped). The dashboard triggers differ between
// desktop ("New appointment") and phone ("New appt"), so S-16 runs on all four projects.

import type { Page, TestInfo } from '@playwright/test'
import { AppointmentDetail } from '../pages/appointment-detail'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect, type E2EFactory } from '../support/factories'
import {
  ACTION_UNREACHABLE_MESSAGE,
  STALE_DEPLOYMENT_MESSAGE,
  expectButtonRecovers,
  expectFailureMessage,
  expectedFaultConsoleErrors,
  failNextServerAction,
  holdNextServerAction,
} from '../support/fault-injection'
import { isMobileProject } from '../support/mobile'

test.use({ serviceWorkers: 'block' })

function guardsFor(page: Page) {
  return attachErrorGuards(page, {
    expectedFailures: expectedFaultConsoleErrors('server-action'),
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }],
  })
}

function phoneOnly(testInfo: TestInfo) {
  testInfo.skip(!isMobileProject(testInfo), 'same control on every viewport: runs on the phone projects (D2)')
}

// --- S-12 Status select ---------------------------------------------------------------------

test('a status change that never reaches the server keeps the old status and works on the next try', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  const guards = guardsFor(page)
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(61), time: '09:35' })
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)

  const fault = await failNextServerAction(page, 'abort')
  await detail.chooseStatus('Scheduled', 'Completed')
  await expect.poll(() => fault.hit()).toBe(true)
  await expectFailureMessage(page, ACTION_UNREACHABLE_MESSAGE)
  // The select is controlled by the saved status, so it shows the old value again.
  await expect(detail.statusSelect('Scheduled')).toBeVisible()
  await expect(detail.statusSelect('Scheduled')).toBeEnabled()
  expect((await factory.findAppointments({ patientId: patient.id }))[0].status).toBe('scheduled')

  await fault.dispose()
  await detail.setStatus('Scheduled', 'Completed')
  await expect.poll(async () => (await factory.findAppointments({ patientId: patient.id }))[0].status).toBe('completed')
  await guards.assertClean()
})

// --- S-13 Delete appointment ----------------------------------------------------------------

test('a delete that fails with a dropped connection leaves the appointment and the dialog usable', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  const guards = guardsFor(page)
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(63), time: '09:45' })
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  const confirm = await detail.openDelete()

  const fault = await failNextServerAction(page, 'abort')
  await confirm.tap()
  await expectButtonRecovers(confirm, { idleName: 'Delete', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(detail.deleteConfirmation().getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
  expect(await factory.findAppointments({ patientId: patient.id })).toHaveLength(1)

  await fault.dispose()
  await confirm.tap()
  await expect(page).toHaveURL(/\/schedule$/)
  expect(await factory.findAppointments({ patientId: patient.id })).toEqual([])
  await guards.assertClean()
})

test('a delete answered with a server error leaves the appointment and the dialog usable', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  const guards = guardsFor(page)
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(63), time: '09:55' })
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  const confirm = await detail.openDelete()

  const fault = await failNextServerAction(page, 'http-500')
  await confirm.tap()
  await expectButtonRecovers(confirm, { idleName: 'Delete', message: ACTION_UNREACHABLE_MESSAGE, fault })
  expect(await factory.findAppointments({ patientId: patient.id })).toHaveLength(1)

  await fault.dispose()
  await confirm.tap()
  await expect(page).toHaveURL(/\/schedule$/)
  expect(await factory.findAppointments({ patientId: patient.id })).toEqual([])
  await guards.assertClean()
})

test('a held delete shows Deleting…, disables both dialog buttons and deletes once released', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  const guards = guardsFor(page)
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(63), time: '10:05' })
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  const confirm = await detail.openDelete()

  const hold = await holdNextServerAction(page)
  await confirm.tap()
  await hold.whenHeld()
  await expect(confirm).toHaveAccessibleName('Deleting…')
  await expect(confirm).toBeDisabled()
  await expect(detail.deleteConfirmation().getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  await confirm.click({ force: true })
  expect(hold.count()).toBe(1)

  await hold.release()
  await expect(page).toHaveURL(/\/schedule$/)
  expect(hold.count()).toBe(1)
  expect(await factory.findAppointments({ patientId: patient.id })).toEqual([])
  await guards.assertClean()
})

// --- S-14 Session notes ---------------------------------------------------------------------

async function openNewNote(page: Page, factory: E2EFactory) {
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({
    patientId: patient.id, date: clinicDate(-47), time: '14:30', status: 'completed', notes: null,
  })
  factory.watchUiSessionNote(appointment.id)
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  const form = await detail.openNotes()
  const subjective = factory.uniqueName('subjective')
  const plan = factory.uniqueName('plan')
  await form.fill({ subjective, plan })
  return { appointment, detail, form, subjective, plan }
}

test('Save Notes recovers from a dropped connection with the typed notes kept', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  const guards = guardsFor(page)
  const { appointment, form, subjective, plan } = await openNewNote(page, factory)

  const fault = await failNextServerAction(page, 'abort')
  await form.saveButton().tap()
  await expectButtonRecovers(form.saveButton(), { idleName: 'Save Notes', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(form.dialog()).toBeVisible()
  await expect(form.field('subjective')).toHaveValue(subjective)
  await expect(form.field('plan')).toHaveValue(plan)
  expect(await factory.findSessionNotes(appointment.id)).toEqual([])

  await fault.dispose()
  await form.save('Notes saved')
  expect(await factory.findSessionNotes(appointment.id)).toHaveLength(1)
  await expect(page.getByText(subjective, { exact: true })).toBeVisible()
  await guards.assertClean()
})

test('Save Notes recovers from a server error with the typed notes kept', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  const guards = guardsFor(page)
  const { appointment, form, subjective } = await openNewNote(page, factory)

  const fault = await failNextServerAction(page, 'http-500')
  await form.saveButton().tap()
  await expectButtonRecovers(form.saveButton(), { idleName: 'Save Notes', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(form.field('subjective')).toHaveValue(subjective)
  expect(await factory.findSessionNotes(appointment.id)).toEqual([])

  await fault.dispose()
  await form.save('Notes saved')
  expect(await factory.findSessionNotes(appointment.id)).toHaveLength(1)
  await guards.assertClean()
})

test('a held Save Notes shows Saving… and saves exactly one note once released', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  const guards = guardsFor(page)
  const { appointment, form, subjective } = await openNewNote(page, factory)

  const hold = await holdNextServerAction(page)
  await form.saveButton().tap()
  await hold.whenHeld()
  await expect(form.saveButton()).toHaveAccessibleName('Saving…')
  await expect(form.saveButton()).toBeDisabled()
  await form.saveButton().click({ force: true })
  expect(hold.count()).toBe(1)

  await hold.release()
  await expect(page.getByText('Notes saved', { exact: true })).toBeVisible()
  await expect(form.dialog()).toBeHidden()
  expect(hold.count()).toBe(1)
  expect(await factory.findSessionNotes(appointment.id)).toHaveLength(1)
  await expect(page.getByText(subjective, { exact: true })).toBeVisible()
  await guards.assertClean()
})

test('G-4: saving notes again after a lost reply keeps exactly one note and still shows it', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  // G-4: the form still thinks the note is new after the lost reply, so the second save arrives
  // with no note id; it must write to the note the first save created, not add a second one.
  const guards = guardsFor(page)
  const { appointment, form, subjective } = await openNewNote(page, factory)

  const fault = await failNextServerAction(page, 'lost-response')
  await form.saveButton().tap()
  await expectButtonRecovers(form.saveButton(), { idleName: 'Save Notes', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect.poll(async () => (await factory.findSessionNotes(appointment.id)).length).toBe(1)
  await fault.dispose()

  await form.saveButton().tap()
  await expect(form.dialog()).toBeHidden()
  await page.reload()
  await expect(page.getByText(subjective, { exact: true })).toBeVisible()
  expect(await factory.findSessionNotes(appointment.id)).toHaveLength(1)
  await guards.assertClean()
})

// --- S-15 Reminders ---------------------------------------------------------------------------

function reminderCard(page: Page, title: string) {
  return page.getByRole('button').filter({ hasText: title })
}

test('creating a reminder recovers from a dropped connection and saves one reminder on retry', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  const guards = guardsFor(page)
  const title = factory.uniqueName('fault-reminder')
  const date = clinicDate(142)
  factory.watchUiReminder(title)
  await page.goto(`/schedule?date=${date}`)
  await page.getByRole('button', { name: 'Add reminder', exact: true }).filter({ visible: true }).tap()
  const dialog = page.getByRole('dialog', { name: 'New reminder' })
  await dialog.getByLabel('What needs following up?').fill(title)
  const save = dialog.getByRole('button', { name: /^(Save reminder|Saving…)$/ })

  const fault = await failNextServerAction(page, 'abort')
  await save.tap()
  await expectButtonRecovers(save, { idleName: 'Save reminder', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(dialog.getByRole('alert')).toHaveText(ACTION_UNREACHABLE_MESSAGE)
  await expect(dialog.getByLabel('What needs following up?')).toHaveValue(title)
  expect(await factory.findReminders({ title })).toEqual([])

  await fault.dispose()
  await save.tap()
  await expect(dialog).toBeHidden()
  await expect(reminderCard(page, title)).toBeVisible()
  expect(await factory.findReminders({ title })).toHaveLength(1)
  await guards.assertClean()
})

test('editing a reminder recovers from a dropped connection and saves on retry', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  const guards = guardsFor(page)
  const date = clinicDate(143)
  const reminder = await factory.createReminder({ date })
  const notes = factory.uniqueName('reminder-notes')
  await page.goto(`/schedule?date=${date}`)
  await reminderCard(page, reminder.title).tap()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Edit or reschedule', exact: true }).tap()
  await dialog.getByText('Add phone or notes', { exact: true }).tap()
  await dialog.getByLabel('Notes · Optional').fill(notes)
  const save = dialog.getByRole('button', { name: /^(Save reminder|Saving…)$/ })

  const fault = await failNextServerAction(page, 'abort')
  await save.tap()
  await expectButtonRecovers(save, { idleName: 'Save reminder', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(dialog.getByLabel('Notes · Optional')).toHaveValue(notes)
  expect((await factory.findReminders({ title: reminder.title }))[0].notes).toBeNull()

  await fault.dispose()
  await save.tap()
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await factory.findReminders({ title: reminder.title }))[0].notes).toBe(notes)
  await guards.assertClean()
})

test('Mark complete recovers from a dropped connection and completes on retry', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  const guards = guardsFor(page)
  const date = clinicDate(144)
  const reminder = await factory.createReminder({ date })
  await page.goto(`/schedule?date=${date}`)
  await reminderCard(page, reminder.title).tap()
  const dialog = page.getByRole('dialog')
  const complete = dialog.getByRole('button', { name: /^(Mark complete|Saving…)$/ })

  const fault = await failNextServerAction(page, 'abort')
  await complete.tap()
  await expectButtonRecovers(complete, { idleName: 'Mark complete', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(dialog.getByRole('button', { name: 'Edit or reschedule', exact: true })).toBeEnabled()
  expect((await factory.findReminders({ title: reminder.title }))[0].status).toBe('pending')

  await fault.dispose()
  await complete.tap()
  await expect(dialog).toBeHidden()
  await expect(reminderCard(page, reminder.title)).toContainText('Completed')
  expect((await factory.findReminders({ title: reminder.title }))[0].status).toBe('completed')
  await guards.assertClean()
})

test('deleting a reminder recovers from a dropped connection and deletes on retry', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  const guards = guardsFor(page)
  const date = clinicDate(145)
  const reminder = await factory.createReminder({ date })
  await page.goto(`/schedule?date=${date}`)
  await reminderCard(page, reminder.title).tap()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Delete reminder', exact: true }).tap()
  const confirm = dialog.getByRole('button', { name: 'Delete', exact: true })

  const fault = await failNextServerAction(page, 'abort')
  await confirm.tap()
  await expect.poll(() => fault.hit()).toBe(true)
  await expect(dialog.getByRole('alert')).toHaveText(ACTION_UNREACHABLE_MESSAGE)
  await expect(confirm).toBeEnabled()
  await expect(dialog.getByRole('button', { name: 'Keep reminder', exact: true })).toBeEnabled()
  await expect(dialog.getByRole('button', { name: 'Saving…' })).toHaveCount(0)
  expect(await factory.findReminders({ title: reminder.title })).toHaveLength(1)

  await fault.dispose()
  await confirm.tap()
  await expect(dialog).toBeHidden()
  await expect(reminderCard(page, reminder.title)).toHaveCount(0)
  expect(await factory.findReminders({ title: reminder.title })).toEqual([])
  await guards.assertClean()
})

// --- S-16 Dashboard dialogs that load their options through an action -------------------------

test('the dashboard New appointment dialog shows a retry when its options fail to load, and Retry opens the form', async ({ page }, testInfo) => {
  const guards = guardsFor(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today', exact: true }).filter({ visible: true })).toBeVisible()
  const trigger = page.getByRole('button', { name: isMobileProject(testInfo) ? 'New appt' : 'New appointment', exact: true })
  await expect(trigger).toBeVisible()

  const fault = await failNextServerAction(page, 'abort')
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'New Appointment' })
  const failure = dialog.getByRole('alert')
  await expect(failure).toContainText(ACTION_UNREACHABLE_MESSAGE)
  expect(fault.hit()).toBe(true)
  await expect(dialog.getByLabel('Patient *', { exact: true })).toHaveCount(0)

  await fault.dispose()
  await failure.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(dialog.getByLabel('Patient *', { exact: true })).toBeVisible()
  await expect(failure).toHaveCount(0)
  await expectNoLeakedNulls(page, { scope: dialog })
  await guards.assertClean()
})

test('a dashboard reminder whose options fail to load says so and opens when selected again', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const reminder = await factory.createReminder({ date: clinicDate() })
  await page.goto('/')
  const section = page.getByRole('region', { name: "Today's reminders" })
  const card = section.getByRole('button').filter({ hasText: reminder.title })
  await expect(card).toBeVisible()

  const fault = await failNextServerAction(page, 'abort')
  await card.click()
  await expect(section.getByRole('alert').filter({ hasText: 'Unable to load reminder options. Select the reminder to retry.' })).toBeVisible()
  expect(fault.hit()).toBe(true)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(card).toBeEnabled()

  await fault.dispose()
  await card.click()
  const dialog = page.getByRole('dialog', { name: 'Reminder' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: reminder.title })).toBeVisible()
  await expectNoLeakedNulls(page, { scope: dialog })
  await guards.assertClean()
})

// --- S-17 Stale deployment ----------------------------------------------------------------------

test('a status change on a stale build says Care-Book was updated, reloads and changes nothing', async ({ page, factory }, testInfo) => {
  testInfo.skip(testInfo.project.name !== 'admin-mobile', 'one stale-build proof is enough: admin-mobile')
  const guards = guardsFor(page)
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(64), time: '10:15' })
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)

  const fault = await failNextServerAction(page, 'stale-deployment')
  const reloaded = page.waitForEvent('load')
  await detail.chooseStatus('Scheduled', 'Completed')
  await expect.poll(() => fault.hit()).toBe(true)
  await expectFailureMessage(page, STALE_DEPLOYMENT_MESSAGE)
  await reloaded
  await expect(page).toHaveURL(`/schedule/${appointment.id}`)
  await expect(detail.statusSelect('Scheduled')).toBeVisible()
  expect((await factory.findAppointments({ patientId: patient.id }))[0].status).toBe('scheduled')
  await fault.dispose()
  await guards.assertClean()
})
