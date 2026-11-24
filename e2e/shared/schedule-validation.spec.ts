// What the appointment form refuses, and how (plan S-3, S-8, S-9). Every refusal must name the
// problem, save nothing and leave "Book Appointment" usable.

import type { Page, TestInfo } from '@playwright/test'
import { AppointmentDetail } from '../pages/appointment-detail'
import { AppointmentForm } from '../pages/appointment-form'
import { CLINIC_A } from '../support/accounts'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect, type E2EFactory } from '../support/factories'
import { expectedFaultConsoleErrors } from '../support/fault-injection'
import { SEED } from '../support/ids'
import { projectRole } from '../support/mobile'
import { adminClient } from '../support/supabase-admin'

const BOOKINGS = '/api/appointments/bookings'

function guardsFor(page: Page, extra: { bookingStatus?: number; supabaseRejects?: boolean } = {}) {
  return attachErrorGuards(page, {
    expectedHttpErrors: [
      { pathname: '/api/telemetry', status: 429 },
      ...(extra.bookingStatus ? [{ pathname: BOOKINGS, status: extra.bookingStatus }] : []),
    ],
    expectedFailures: extra.supabaseRejects ? [
      ...expectedFaultConsoleErrors('rest/v1/appointments'),
      { url: /^http:\/\/localhost:3000\//, text: /AppointmentForm\/save/ },
    ] : [],
  })
}

/** Counts booking POSTs, so a refusal can prove nothing was sent. */
function countBookingRequests(page: Page) {
  let count = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === BOOKINGS) count += 1
  })
  return () => count
}

async function appointmentsWithNotes(notes: string) {
  const { data, error } = await adminClient().from('appointments').select('id').eq('clinic_id', CLINIC_A.id).eq('notes', notes)
  if (error) throw error
  return data ?? []
}

function notifications(page: Page) {
  // includeHidden: an open modal (Edit dialog) marks the toast region aria-hidden.
  return page.getByRole('region', { name: 'Notifications (F8)', includeHidden: true })
}

async function openNewForm(page: Page, factory: E2EFactory) {
  const sharedType = await factory.findAppointmentType(true)
  await page.goto('/schedule/new')
  await expect(page.getByLabel('Patient *', { exact: true })).toBeVisible()
  // Pick the type explicitly: /schedule/new preselects the clinic's default type (G-19, below),
  // which need not be the shared type these cases price and assign against.
  const form = new AppointmentForm(page, sharedType.name)
  await form.chooseType(sharedType.name)
  return form
}

function bookButton(page: Page) {
  return page.getByRole('button', { name: 'Book Appointment', exact: true })
}

test('G-19: /schedule/new preselects the default appointment type once the types load', async ({ page, factory }) => {
  // G-19: the form loads the clinic's types in the browser. Setting the default in the same render
  // that first mounted the options made Radix's hidden native <select> report '', which wiped the
  // type back to "Select type". The dashboard dialog, which passes the types in, was unaffected.
  const guards = guardsFor(page)
  const sharedType = await factory.findAppointmentType(true)
  await page.goto('/schedule/new')
  await expect(page.getByLabel('Patient *', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Type', { exact: true })).toHaveText(sharedType.name)
  await guards.assertClean()
})

// --- S-8 ------------------------------------------------------------------------------------

test('Book without a patient says a patient is required and books nothing', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const sent = countBookingRequests(page)
  const notes = factory.uniqueName('no-patient')
  const form = await openNewForm(page, factory)
  await page.getByLabel('Date *', { exact: true }).fill(clinicDate(81))
  await page.getByLabel('Time *', { exact: true }).fill('08:05')
  await form.field('notes').fill(notes)

  await bookButton(page).click()
  await expect(notifications(page).getByText('Patient required', { exact: true })).toBeVisible()
  await expect(notifications(page)).toContainText('Select an existing patient or create a new patient before booking.')
  await expect(page).toHaveURL(/\/schedule\/new/)
  await expect(bookButton(page)).toBeEnabled()
  expect(sent()).toBe(0)
  expect(await appointmentsWithNotes(notes)).toEqual([])
  await guards.assertClean()
})

test('an inline patient without a phone is stopped before anything is sent', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const sent = countBookingRequests(page)
  const name = factory.uniqueName('inline-no-phone')
  factory.watchUiPatient(name)
  const form = await openNewForm(page, factory)
  await form.fill({ patientName: name, date: clinicDate(82), time: '08:10', newPatient: { phone: '' } })

  // Blank: the browser's own required-field check stops the submit and points at the phone.
  await bookButton(page).click()
  const phone = page.getByLabel('Phone *', { exact: true })
  await expect(phone).toBeFocused()
  expect(await phone.evaluate((input: HTMLInputElement) => input.validationMessage)).not.toBe('')
  expect(sent()).toBe(0)

  // Spaces pass the browser check; the form's own check names the problem.
  await phone.fill('   ')
  await bookButton(page).click()
  await expect(notifications(page).getByText('Patient details required', { exact: true })).toBeVisible()
  await expect(notifications(page)).toContainText('Please enter at least the patient name and phone number.')
  await expect(bookButton(page)).toBeEnabled()
  expect(sent()).toBe(0)
  expect(await factory.findPatientByName(name)).toBeNull()
  await guards.assertClean()
})

test('a repeat schedule of 0 or 101 sessions is explained and nothing is sent', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const sent = countBookingRequests(page)
  const patient = await factory.createPatient()
  const notes = factory.uniqueName('bad-session-count')
  const form = await openNewForm(page, factory)
  await form.fill({ patientName: patient.name as string, date: clinicDate(83), time: '08:15', notes })
  const repeat = page.getByRole('switch', { name: 'Toggle repeat appointment' })
  await repeat.click()
  await expect(repeat).toHaveAttribute('aria-checked', 'true')
  const sessions = page.getByLabel('Total sessions *', { exact: true })

  for (const count of ['0', '101']) {
    await sessions.fill(count)
    await expect(page.getByText('Total sessions must be between 1 and 100.', { exact: true })).toBeVisible()
    await bookButton(page).click()
    // The field's own min/max stop the submit; the inline message says why.
    expect(await sessions.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false)
    await expect(bookButton(page)).toBeEnabled()
  }
  expect(sent()).toBe(0)
  expect(await factory.findAppointments({ patientId: patient.id })).toEqual([])
  await guards.assertClean()
})

test('a repeat schedule with no weekday says to choose one and books nothing', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const sent = countBookingRequests(page)
  const patient = await factory.createPatient()
  const date = clinicDate(84)
  const form = await openNewForm(page, factory)
  await form.fill({ patientName: patient.name as string, date, time: '08:20' })
  const repeat = page.getByRole('switch', { name: 'Toggle repeat appointment' })
  await repeat.click()
  // Repeat preselects the start date's weekday; untick it.
  const selected = page.locator('button[aria-pressed="true"]').filter({ hasText: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/ })
  await expect(selected).toHaveCount(1)
  await selected.click()
  await expect(page.getByText('Choose at least one valid weekday.', { exact: true })).toBeVisible()

  await bookButton(page).click()
  await expect(notifications(page).getByText('Repeat schedule required', { exact: true })).toBeVisible()
  await expect(notifications(page)).toContainText('Choose at least one valid weekday.')
  await expect(bookButton(page)).toBeEnabled()
  expect(sent()).toBe(0)
  expect(await factory.findAppointments({ patientId: patient.id })).toEqual([])
  await guards.assertClean()
})

test('an admin who clears the session fee is asked for one; staff never see the fee', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const sent = countBookingRequests(page)
  const patient = await factory.createPatient()
  const form = await openNewForm(page, factory)
  await form.fill({ patientName: patient.name as string, date: clinicDate(85), time: '08:25' })
  if (projectRole(testInfo) !== 'admin') {
    await expect(form.field('fee')).toHaveCount(0)
    await guards.assertClean()
    return
  }

  await form.clear('fee')
  await bookButton(page).click()
  await expect(notifications(page).getByText('Session fee required', { exact: true })).toBeVisible()
  await expect(notifications(page)).toContainText('Choose a type with a default rate or enter a session fee before booking.')
  await expect(bookButton(page)).toBeEnabled()
  expect(sent()).toBe(0)
  expect(await factory.findAppointments({ patientId: patient.id })).toEqual([])
  await guards.assertClean()
})

// --- S-9 ------------------------------------------------------------------------------------

function adminPhoneOnly(testInfo: TestInfo) {
  testInfo.skip(testInfo.project.name !== 'admin-mobile', 'duration validation runs once, on admin-mobile')
}

test('a negative duration is refused when booking and the form stays usable', async ({ page, factory }, testInfo) => {
  adminPhoneOnly(testInfo)
  const guards = guardsFor(page, { bookingStatus: 400 })
  const patient = await factory.createPatient()
  const notes = factory.uniqueName('negative-duration')
  const form = await openNewForm(page, factory)
  await form.fill({ patientName: patient.name as string, date: clinicDate(86), time: '08:30', durationMinutes: '-5', notes })

  await bookButton(page).tap()
  await expect(notifications(page).getByText('Appointment not booked', { exact: true })).toBeVisible()
  await expect(notifications(page)).toContainText('Check the appointment details and try again.')
  await expect(page).toHaveURL(/\/schedule\/new/)
  await expect(bookButton(page)).toBeEnabled()
  await expect(form.field('duration')).toHaveValue('-5')
  expect(await factory.findAppointments({ patientId: patient.id })).toEqual([])
  await guards.assertClean()
})

test('a negative duration is refused on Edit and the stored duration is kept', async ({ page, factory }, testInfo) => {
  adminPhoneOnly(testInfo)
  const guards = guardsFor(page, { supabaseRejects: true })
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(87), time: '08:35', duration_minutes: 50 })
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  const form = await detail.openEdit()
  await form.fillEdit({ durationMinutes: '-5' })

  await detail.editDialog().getByRole('button', { name: 'Update', exact: true }).tap()
  await expect(notifications(page).getByText('Appointment not updated', { exact: true })).toBeVisible()
  await expect(detail.editDialog()).toBeVisible()
  await expect(detail.editDialog().getByRole('button', { name: 'Update', exact: true })).toBeEnabled()
  expect((await factory.findAppointments({ patientId: patient.id }))[0].duration_minutes).toBe(50)
  await guards.assertClean()
})

test('G-17c: a duration of 0 on Edit is refused instead of silently becoming 45 minutes', async ({ page, factory }, testInfo) => {
  adminPhoneOnly(testInfo)
  testInfo.fail(true, 'G-17c: Edit turns a duration of 0 into 45 without a word')
  const guards = guardsFor(page, { supabaseRejects: true })
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(87), time: '08:40', duration_minutes: 50 })
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  const form = await detail.openEdit()
  await form.fillEdit({ durationMinutes: '0' })

  await detail.editDialog().getByRole('button', { name: 'Update', exact: true }).tap()
  const toast = notifications(page).locator('li').first()
  await expect(toast).toBeVisible()
  await expect(toast).not.toContainText('Appointment updated')
  await expect(detail.editDialog()).toBeVisible()
  expect((await factory.findAppointments({ patientId: patient.id }))[0].duration_minutes).toBe(50)
  await guards.assertClean()
})

// --- S-3 (decision D4c) -----------------------------------------------------------------------

function adminOnly(testInfo: TestInfo) {
  testInfo.skip(projectRole(testInfo) !== 'admin', 'the session fee is admin-only')
}

test('C-3: clearing the session fee on Edit is refused with a message and the stored fee is kept', async ({ page, factory }, testInfo) => {
  adminOnly(testInfo)
  testInfo.fail(true, 'C-3 (behaviour change, own fix branch): Edit Appointment saves a cleared fee as NULL')
  const guards = guardsFor(page)
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(88), time: '08:45', fee: 800 })
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  const form = await detail.openEdit()
  await form.clear('fee')

  await detail.editDialog().getByRole('button', { name: 'Update', exact: true }).click()
  const toast = notifications(page).locator('li').first()
  await expect(toast).toBeVisible()
  await expect(toast).not.toContainText('Appointment updated')
  await expect(toast).toContainText(/fee/i)
  await expect(detail.editDialog()).toBeVisible()
  expect(Number((await factory.findAppointments({ patientId: patient.id }))[0].fee)).toBe(800)
  await guards.assertClean()
})

test('a session fee of 0 is a valid free session on Edit', async ({ page, factory }, testInfo) => {
  adminOnly(testInfo)
  const guards = guardsFor(page)
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(88), time: '08:50', fee: 800 })
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  const form = await detail.openEdit()
  await form.fillEdit({ fee: '0' })
  await form.submitUpdate()
  await expect(detail.editDialog()).toBeHidden()
  await expect.poll(async () => (await factory.findAppointments({ patientId: patient.id }))[0].fee).toBe(0)
  await expect(page.getByText('₹0', { exact: true })).toBeVisible()
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('a legacy appointment with no fee renders everywhere and can be completed', async ({ page, factory }, testInfo) => {
  adminOnly(testInfo)
  const guards = guardsFor(page)
  const patient = await factory.createPatient()
  const today = clinicDate()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: today, time: '06:05', fee: null })
  const name = patient.name as string

  await page.goto(`/schedule?date=${today}`)
  await expect(page.getByRole('link', { name: new RegExp(name) }).filter({ visible: true })).toBeVisible()
  await expectNoLeakedNulls(page)
  await page.goto('/')
  await expect(page.getByRole('link', { name: new RegExp(name) }).filter({ visible: true }).first()).toBeVisible()
  await expectNoLeakedNulls(page)

  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  await expectNoLeakedNulls(page)
  // The fee line is left out rather than rendered as ₹0 or "₹null".
  await expect(page.getByText(/^₹/)).toHaveCount(0)
  await detail.setStatus('Scheduled', 'Completed')
  await expect.poll(async () => (await factory.findAppointments({ patientId: patient.id }))[0].status).toBe('completed')
  await expectNoLeakedNulls(page)

  await page.goto(`/billing/payment-due/${patient.id}`)
  await expect(page.getByText(name, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expectNoLeakedNulls(page)

  // The seeded legacy row (SEED.appointmentSparse, fee NULL) on its own screens. Read-only: seeded
  // rows are never changed by a spec.
  const { data: sparse, error } = await adminClient().from('appointments').select('date').eq('id', SEED.appointmentSparse).single()
  if (error) throw error
  await page.goto(`/schedule?date=${sparse.date}`)
  await expectNoLeakedNulls(page)
  await page.goto(`/schedule/${SEED.appointmentSparse}`)
  await expect(page.getByText('Status:', { exact: true })).toBeVisible()
  await expectNoLeakedNulls(page)
  await page.goto(`/billing/payment-due/${SEED.patientSparse}`)
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})
