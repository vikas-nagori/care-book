// Edit Appointment (the detail page's dialog), which writes straight to `appointments` from the
// browser (plan S-1, S-10, S-11).

import { format, parseISO } from 'date-fns'
import type { Page, TestInfo } from '@playwright/test'
import { AppointmentDetail } from '../pages/appointment-detail'
import { STAFF, STAFF2 } from '../support/accounts'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect, type E2EFactory } from '../support/factories'
import {
  expectButtonRecovers,
  expectedFaultConsoleErrors,
  failNextSupabaseCall,
  holdNextSupabaseCall,
} from '../support/fault-injection'
import { isMobileProject, projectRole } from '../support/mobile'

test.use({ serviceWorkers: 'block' })

/** What the form says when the browser's update of the row fails (appointment-form.tsx). */
const UPDATE_FAILED = 'Please check the appointment and try again.'

function guardsFor(page: Page) {
  return attachErrorGuards(page, {
    expectedFailures: [
      ...expectedFaultConsoleErrors('rest/v1/appointments'),
      // The form logs the failed update through the client logger (console.error).
      { url: /^http:\/\/localhost:3000\//, text: /AppointmentForm\/save/ },
    ],
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }],
  })
}

function phoneOnly(testInfo: TestInfo) {
  testInfo.skip(!isMobileProject(testInfo), 'same dialog on every viewport: runs on the phone projects (D2)')
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('edits every field of a scheduled appointment and shows the change on the detail and the day view', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const admin = projectRole(testInfo) === 'admin'
  const original = await factory.createPatient()
  const moved = await factory.createPatient()
  const sharedType = await factory.findAppointmentType(true)
  const privateType = await factory.findAppointmentType(false)
  const assignee = await factory.findProfileByEmail(admin ? STAFF2.email : STAFF.email)
  const assigneeName = assignee.full_name || assignee.email
  const appointment = await factory.createAppointment({
    patientId: original.id, appointmentTypeId: sharedType.id, date: clinicDate(66), time: '09:00', fee: 800,
  })
  const date = clinicDate(-9)
  const notes = factory.uniqueName('edited-notes')

  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  const form = await detail.openEdit()
  await expectNoLeakedNulls(page, { scope: detail.editDialog() })
  await form.fillEdit({
    patientName: moved.name as string,
    date,
    time: '11:40',
    durationMinutes: '60',
    appointmentTypeName: privateType.name,
    assignedStaffLabel: new RegExp(`^${escape(assigneeName)}\\s*\\(${assignee.role === 'admin' ? 'Admin' : 'Staff'}\\)$`),
    ...(admin ? { fee: '900' } : {}),
    status: 'Completed',
    notes,
  })
  await form.submitUpdate()
  await expect(detail.editDialog()).toBeHidden()

  const [row] = await factory.findAppointments({ patientId: moved.id, notes })
  expect(row).toMatchObject({
    id: appointment.id,
    date,
    time: '11:40:00',
    duration_minutes: 60,
    appointment_type_id: privateType.id,
    type_is_shared: false,
    assigned_to: assignee.id,
    status: 'completed',
    notes,
  })
  expect(Number(row.fee)).toBe(admin ? 900 : 800)
  expect(await factory.findAppointments({ patientId: original.id })).toEqual([])

  // The detail re-renders from the server with the saved row.
  await expect(page.getByRole('link', { name: moved.name as string, exact: true })).toBeVisible()
  await expect(page.getByText(format(parseISO(date), 'EEEE, dd MMM yyyy'), { exact: true })).toBeVisible()
  await expect(page.getByText(/11:40 AM · 60min/)).toBeVisible()
  await expect(page.getByText(notes, { exact: true })).toBeVisible()
  await expect(page.getByRole('main').getByText(assigneeName, { exact: true }).first()).toBeVisible()
  await expect(detail.statusSelect('Completed')).toBeVisible()
  if (admin) await expect(page.getByText('₹900', { exact: true })).toBeVisible()
  else await expect(page.getByText('₹900', { exact: true })).toHaveCount(0)
  await expectNoLeakedNulls(page)

  await page.goto(`/schedule?date=${date}`)
  const chip = page.getByRole('link', { name: new RegExp(escape(moved.name as string)) }).filter({ visible: true })
  await expect(chip).toBeVisible()
  await expect(chip).toContainText('11:40 AM')
  await expect(page.getByRole('link', { name: new RegExp(escape(original.name as string)) }).filter({ visible: true })).toHaveCount(0)
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

// --- S-10: the row disappears while the user is looking at it (G-3) ---------------------------

test('G-3: updating an appointment that was deleted meanwhile does not report success', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  const guards = guardsFor(page)
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(67), time: '09:10' })
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  const form = await detail.openEdit()
  await form.fillEdit({ notes: factory.uniqueName('too-late') })

  await factory.deleteAppointmentHard(appointment.id)
  await detail.editDialog().getByRole('button', { name: 'Update', exact: true }).tap()
  const toast = page.getByRole('region', { name: 'Notifications (F8)', includeHidden: true }).locator('li').first()
  await expect(toast).toBeVisible()
  await expect(toast).not.toContainText('Appointment updated')
  await expect(toast).toContainText('This appointment no longer exists.')
  await expect(detail.editDialog()).toBeVisible()
  await guards.assertClean()
})

test('G-3: a status change on an appointment that was deleted meanwhile does not report success', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  const guards = guardsFor(page)
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(67), time: '09:20' })
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)

  await factory.deleteAppointmentHard(appointment.id)
  await detail.chooseStatus('Scheduled', 'Completed')
  const toast = page.getByRole('region', { name: 'Notifications (F8)', includeHidden: true }).locator('li').first()
  await expect(toast).toBeVisible()
  await expect(toast).not.toContainText('Status updated')
  await expect(toast).toContainText('This appointment no longer exists.')
  await guards.assertClean()
})

// --- S-11: the browser's PATCH fails -----------------------------------------------------------

async function openFilledEdit(page: Page, factory: E2EFactory, time: string) {
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(68), time })
  const notes = factory.uniqueName('edit-fault')
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  const form = await detail.openEdit()
  await form.fillEdit({ time: '12:50', notes })
  const update = detail.editDialog().getByRole('button', { name: /^(Update|Saving…)$/ })
  return { patient, appointment, notes, detail, form, update }
}

async function expectUnchanged(factory: E2EFactory, patientId: string, original: { time: string; notes: string | null }) {
  const [row] = await factory.findAppointments({ patientId })
  expect(row).toMatchObject({ time: `${original.time}:00`, notes: original.notes })
}

test('Update recovers from a dropped connection with the edited values kept', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  const guards = guardsFor(page)
  const { patient, appointment, notes, detail, form, update } = await openFilledEdit(page, factory, '09:30')

  const fault = await failNextSupabaseCall(page, { resource: 'rest/v1/appointments', method: 'PATCH', mode: 'abort' })
  await update.tap()
  await expectButtonRecovers(update, { idleName: 'Update', message: UPDATE_FAILED, fault })
  await expect(detail.editDialog()).toBeVisible()
  await expect(form.field('notes')).toHaveValue(notes)
  await expect(form.field('time')).toHaveValue('12:50')
  await expectUnchanged(factory, patient.id, { time: '09:30', notes: appointment.notes })

  await fault.dispose()
  await form.submitUpdate()
  await expect(detail.editDialog()).toBeHidden()
  const rows = await factory.findAppointments({ patientId: patient.id })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ time: '12:50:00', notes })
  await guards.assertClean()
})

test('Update recovers from a rejected write with the edited values kept', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  const guards = guardsFor(page)
  const { patient, appointment, notes, detail, form, update } = await openFilledEdit(page, factory, '09:40')

  const fault = await failNextSupabaseCall(page, { resource: 'rest/v1/appointments', method: 'PATCH', mode: 'http-500' })
  await update.tap()
  await expectButtonRecovers(update, { idleName: 'Update', message: UPDATE_FAILED, fault })
  await expect(form.field('notes')).toHaveValue(notes)
  await expectUnchanged(factory, patient.id, { time: '09:40', notes: appointment.notes })

  await fault.dispose()
  await form.submitUpdate()
  await expect(detail.editDialog()).toBeHidden()
  expect((await factory.findAppointments({ patientId: patient.id }))[0]).toMatchObject({ time: '12:50:00', notes })
  await guards.assertClean()
})

test('a held Update shows Saving…, locks the form and saves once released', async ({ page, factory }, testInfo) => {
  phoneOnly(testInfo)
  const guards = guardsFor(page)
  const { patient, notes, detail, form, update } = await openFilledEdit(page, factory, '09:50')

  const hold = await holdNextSupabaseCall(page, { resource: 'rest/v1/appointments', method: 'PATCH' })
  await update.tap()
  await hold.whenHeld()
  await expect(update).toHaveAccessibleName('Saving…')
  await expect(update).toBeDisabled()
  await expect(form.field('notes')).toBeDisabled()
  await update.click({ force: true })
  expect(hold.count()).toBe(1)

  await hold.release()
  await expect(page.getByText('Appointment updated', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(detail.editDialog()).toBeHidden()
  expect(hold.count()).toBe(1)
  expect((await factory.findAppointments({ patientId: patient.id }))[0]).toMatchObject({ time: '12:50:00', notes })
  await guards.assertClean()
})
