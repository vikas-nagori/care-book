import { randomUUID } from 'node:crypto'
import type { APIRequestContext, Page, Route } from '@playwright/test'
import type { BookingRequest, CreateAppointmentResult } from '../../src/lib/appointments/booking-contract'
import { AppointmentForm } from '../pages/appointment-form'
import { attachErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'

const BOOKINGS = '/api/appointments/bookings'

// Fault injection must reach Playwright's request router rather than a service worker.
test.use({ serviceWorkers: 'block' })

async function apiBooking(api: APIRequestContext, body: BookingRequest, mode: 'create' | 'status' = 'create') {
  const response = await api.post(`${BOOKINGS}${mode === 'status' ? '/status' : ''}`, {
    data: body, headers: { origin: 'http://localhost:3000' },
  })
  expect(response.headers()['x-correlation-id']).toBe(body.correlationId)
  return await response.json() as CreateAppointmentResult
}

async function fillBooking(page: Page, typeName: string, patientName: string, date: string, time: string, notes: string) {
  await new AppointmentForm(page, typeName).fill({ patientName, date, time, notes, durationMinutes: '45' })
}

test('reopens the schedule dialog across refresh and saves successive appointments after 2 PM', async ({ page, factory }) => {
  const guards = attachErrorGuards(page, { expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }] })
  const patient = await factory.createPatient()
  const type = await factory.findAppointmentType(true)
  const date = clinicDate(105)
  const notes = factory.uniqueName('successive-afternoon-bookings')
  const correlations: string[] = []
  factory.watchUiAppointments({ patientId: patient.id, notes })
  page.on('request', request => {
    if (new URL(request.url()).pathname === BOOKINGS && request.method() === 'POST') {
      correlations.push((request.postDataJSON() as BookingRequest).correlationId)
    }
  })
  await page.goto(`/schedule?date=${date}`)

  for (const time of ['14:15', '15:00', '16:30']) {
    await page.getByRole('button', { name: /^New appointment$/i }).filter({ visible: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New Appointment', exact: true })
    await expect(dialog).toBeVisible()
    await fillBooking(page, type.name, patient.name as string, date, time, notes)
    await dialog.getByRole('button', { name: 'Book Appointment', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect.poll(async () => (await factory.findAppointments({ patientId: patient.id, notes }))
      .some(row => row.time === `${time}:00`)).toBe(true)
  }

  const rows = await factory.findAppointments({ patientId: patient.id, notes })
  expect(rows.map(row => row.time)).toEqual(['14:15:00', '15:00:00', '16:30:00'])
  expect(new Set(correlations).size).toBe(3)
  await expect(page.getByRole('link', { name: new RegExp(patient.name as string) }).filter({ visible: true })).toHaveCount(3)
  await guards.assertClean()
})

test('concurrent retries and replay create one inline patient and one recurring series in the real database', async ({ page, factory }) => {
  const type = await factory.findAppointmentType(true)
  const name = factory.uniqueName('idempotent-inline-patient')
  const notes = factory.uniqueName('idempotent-recurring-booking')
  factory.watchUiPatient(name)
  const body: BookingRequest = {
    correlationId: randomUUID(),
    input: {
      newPatient: {
        name, phone: factory.uniqueMobile(), email: null, dob: null, gender: null,
        address: null, medical_history: null, notes: null, referral_source: null,
        referred_by_doctor_id: null, referred_by_patient_id: null, referral_other: null,
      },
      date: clinicDate(106), time: '15:20', durationMinutes: 45,
      appointmentTypeId: type.id, fee: Number(type.session_rate), notes,
      recurrence: { weekdays: [0, 1, 2, 3, 4, 5, 6], totalSessions: 3 },
    },
  }
  const concurrent = await Promise.all([
    apiBooking(page.request, body), apiBooking(page.request, body), apiBooking(page.request, body),
  ])
  expect(concurrent.some(result => result.success)).toBe(true)
  for (const result of concurrent) {
    if (!result.success) expect(result.errorCode).toBe('BOOKING_UNCONFIRMED')
  }
  const confirmed = await apiBooking(page.request, body, 'status')
  expect(confirmed.success).toBe(true)
  if (!confirmed.success) throw new Error('The committed recurring booking was not found')
  expect(confirmed.appointmentIds).toHaveLength(3)
  expect(new Set(confirmed.appointmentIds).size).toBe(3)
  const replay = await apiBooking(page.request, body)
  expect(replay).toEqual(confirmed)
  const patient = await factory.findPatientByName(name)
  expect(patient?.id).toBe(confirmed.createdPatientId)
  factory.watchUiAppointments({ patientId: patient!.id, notes })
  const rows = await factory.findAppointments({ patientId: patient!.id, notes })
  expect(rows).toHaveLength(3)
  expect(rows.map(row => row.id).sort()).toEqual([...confirmed.appointmentIds].sort())

  const changed = await apiBooking(page.request, { ...body, input: { ...body.input, time: '17:20' } })
  expect(changed).toMatchObject({ success: false, errorCode: 'BOOKING_INTENT_MISMATCH' })
  expect(await factory.findAppointments({ patientId: patient!.id, notes })).toHaveLength(3)
})

test('a booking stuck on a dead connection is resent automatically without the recovery popup', async ({ page, factory }) => {
  // iOS Safari can hold a POST on a silently dropped idle connection; the form abandons it and resends.
  const patient = await factory.createPatient()
  const type = await factory.findAppointmentType(true)
  const date = clinicDate(109)
  const notes = factory.uniqueName('dead-connection-booking')
  factory.watchUiAppointments({ patientId: patient.id, notes })
  const writes: BookingRequest[] = []
  let held: Route | undefined
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.clock.install()
  await page.route(`**${BOOKINGS}`, async route => {
    writes.push(route.request().postDataJSON() as BookingRequest)
    if (writes.length === 1) { held = route; return }
    await route.continue()
  })
  await page.goto('/schedule/new')
  await fillBooking(page, type.name, patient.name as string, date, '17:10', notes)
  await page.getByRole('button', { name: 'Book Appointment', exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled()
  await page.clock.fastForward(6_001)
  await expect(page).toHaveURL(/\/schedule(?:\?.*)?$/)
  await expect(page.getByRole('alert').filter({ hasText: 'Booking not confirmed' })).toHaveCount(0)
  await held!.abort('timedout').catch(() => {})
  expect(writes).toHaveLength(2)
  expect(writes[1]).toEqual(writes[0])
  const rows = await factory.findAppointments({ patientId: patient.id, notes })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ date, time: '17:10:00', notes })
  expect(pageErrors).toEqual([])
})

test('a reply lost on every attempt is recovered by Check booking without another creation request', async ({ page, factory }, testInfo) => {
  const patient = await factory.createPatient()
  const type = await factory.findAppointmentType(true)
  const date = clinicDate(107)
  const notes = factory.uniqueName('lost-response')
  factory.watchUiAppointments({ patientId: patient.id, notes })
  const committed: CreateAppointmentResult[] = []
  const writes: BookingRequest[] = []
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route(`**${BOOKINGS}`, async route => {
    writes.push(route.request().postDataJSON() as BookingRequest)
    const response = await route.fetch()
    committed.push(await response.json() as CreateAppointmentResult)
    await route.abort('failed')
  })
  await page.goto('/schedule/new')
  await fillBooking(page, type.name, patient.name as string, date, '15:35', notes)
  await page.getByRole('button', { name: 'Book Appointment', exact: true }).click()
  const recovery = page.getByRole('alert').filter({ hasText: 'Booking not confirmed' })
  await expect(recovery).toBeVisible()
  // Every automatic resend reached the server with the same booking and found the one saved copy.
  expect(writes).toHaveLength(4)
  for (const write of writes) expect(write).toEqual(writes[0])
  expect(committed.every(result => result.success)).toBe(true)
  await expect(recovery).toContainText(writes[0].correlationId)
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(notes)
  await expect(page.getByLabel('Notes', { exact: true })).toBeDisabled()
  await expect(recovery.getByRole('button', { name: 'Retry same booking', exact: true })).toHaveCount(0)
  const before = await factory.findAppointments({ patientId: patient.id, notes })
  expect(before).toHaveLength(1)
  await recovery.scrollIntoViewIfNeeded()
  // The app scrolls its main pane; leave the recovery controls above the fixed mobile nav.
  await page.locator('main').evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(recovery.getByRole('button', { name: 'Check booking', exact: true })).toBeVisible()
  await recovery.screenshot({ path: testInfo.outputPath('booking-recovery.png') })

  const checked = page.waitForRequest(request => new URL(request.url()).pathname === `${BOOKINGS}/status`)
  await recovery.getByRole('button', { name: 'Check booking', exact: true }).click()
  expect((await checked).postDataJSON()).toEqual(writes[0])
  await expect(page).toHaveURL(/\/schedule(?:\?.*)?$/)
  expect(writes).toHaveLength(4)
  const after = await factory.findAppointments({ patientId: patient.id, notes })
  expect(after.map(row => row.id)).toEqual(before.map(row => row.id))
  expect(pageErrors).toEqual([])
})

test('an outage that outlasts automatic resends unlocks Retry same booking with the exact original request', async ({ page, factory }) => {
  const patient = await factory.createPatient()
  const type = await factory.findAppointmentType(true)
  const date = clinicDate(108)
  const notes = factory.uniqueName('outage-booking')
  factory.watchUiAppointments({ patientId: patient.id, notes })
  const writes: BookingRequest[] = []
  let offline = true
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route(`**${BOOKINGS}`, async route => {
    writes.push(route.request().postDataJSON() as BookingRequest)
    if (offline) { await route.abort('internetdisconnected'); return }
    await route.continue()
  })
  await page.goto('/schedule/new')
  await fillBooking(page, type.name, patient.name as string, date, '16:45', notes)
  await page.getByRole('button', { name: 'Book Appointment', exact: true }).click()
  const recovery = page.getByRole('alert').filter({ hasText: 'Booking not confirmed' })
  await expect(recovery).toBeVisible()
  await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toHaveCount(0)
  expect(writes).toHaveLength(4)
  expect(await factory.findAppointments({ patientId: patient.id, notes })).toEqual([])

  const status = page.waitForRequest(request => new URL(request.url()).pathname === `${BOOKINGS}/status`)
  await recovery.getByRole('button', { name: 'Check booking', exact: true }).click()
  expect((await status).postDataJSON()).toEqual(writes[0])
  await expect(recovery).toContainText('No saved appointment found')
  await expect(page.getByLabel('Time *', { exact: true })).toHaveValue('16:45')
  await expect(page.getByLabel('Time *', { exact: true })).toBeDisabled()
  offline = false
  await recovery.getByRole('button', { name: 'Retry same booking', exact: true }).click()
  await expect(page).toHaveURL(/\/schedule(?:\?.*)?$/)
  expect(writes).toHaveLength(5)
  for (const write of writes) expect(write).toEqual(writes[0])
  const rows = await factory.findAppointments({ patientId: patient.id, notes })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ date, time: '16:45:00', notes })
  expect(pageErrors).toEqual([])
})
