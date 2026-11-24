// What External Staff see when a booking, reschedule or cancellation cannot go through (plan 5.5,
// X-5 to X-10): refusals the server explains, appointments that changed under the dialog, a
// dropped or failed request, and a request still in flight. Every dialog must come back usable
// and the database must hold exactly what the user meant.

import type { Page, Request, Route } from '@playwright/test'

import {
  ExternalAppointmentDialog,
  ExternalBookingDialog,
  press,
  scheduleChip,
  signInWithMobile,
  EXTERNAL_OBSERVABILITY_REDIRECT_NOISE,
} from '../pages/external-dialogs'
import { CLINIC_A, EXTERNAL } from '../support/accounts'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect, type E2EFactory } from '../support/factories'
import {
  expectButtonRecovers,
  expectedFaultConsoleErrors,
  failNextServerAction,
  holdNextServerAction,
  isServerActionRequest,
} from '../support/fault-injection'
import { SPARSE_NAMES } from '../support/ids'
import { adminClient } from '../support/supabase-admin'
import { EXTERNAL_ACCESS_MESSAGE } from '../../src/lib/external/workspace'

// Faults must reach Playwright's router, not the service worker.
test.use({ serviceWorkers: 'block' })

// The dialogs' own copy for a request that never answered (booking-dialog.tsx, appointment-dialog.tsx).
const BOOKING_UNCONFIRMED = 'Unable to confirm this booking. Try again to check if it was saved.'
const CHANGE_UNCONFIRMED = 'Unable to confirm this change. Refresh to check whether it was saved.'
const DUPLICATE_BOOKING = 'You already have an appointment for this patient at that time.'
const NO_LONGER_CHANGEABLE = 'This appointment can no longer be changed.'

function guardsFor(page: Page) {
  return attachErrorGuards(page, {
    expectedFailures: [...expectedFaultConsoleErrors('server-action'), ...EXTERNAL_OBSERVABILITY_REDIRECT_NOISE],
    // reportClientError's telemetry budget can answer 429 when the matrix runs back to back.
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }],
  })
}

/** A disposable name-only patient shared with the seeded EXTERNAL account, and a type to book. */
async function sharedPatient(factory: E2EFactory) {
  const external = await factory.findProfileByEmail(EXTERNAL.email)
  const patient = await factory.createPatient({ phone: null })
  await factory.shareWithExternal(patient.id, [external.id])
  const type = await factory.findAppointmentType(true)
  return { patient, type, external }
}

async function appointmentsOf(patientId: string) {
  const { data, error } = await adminClient().from('appointments')
    .select('id, date, time, duration_minutes, status, appointment_type_id')
    .eq('patient_id', patientId)
  expect(error).toBeNull()
  return data ?? []
}

/** Booking ids the page sent in server-action bodies (the dialog's idempotency key). */
function recordBookingIds(page: Page): string[] {
  const ids: string[] = []
  page.on('request', (request: Request) => {
    if (!isServerActionRequest(request)) return
    const match = request.postData()?.match(/"id":"([0-9a-f-]{36})"/)
    if (match) ids.push(match[1])
  })
  return ids
}

test('booking the same slot twice shows the duplicate message and keeps one appointment', async ({ page, factory }, testInfo) => {
  const { patient, type } = await sharedPatient(factory)
  const date = clinicDate(6)
  const guards = guardsFor(page)
  await page.goto(`/external?date=${date}`)

  const first = await ExternalBookingDialog.open(page, testInfo)
  await first.fill({ patientId: patient.id, typeId: type.id, time: '11:00' })
  await press(first.submit, testInfo)
  await expect(first.dialog).toBeHidden()
  await expect.poll(async () => (await appointmentsOf(patient.id)).length).toBe(1)

  const second = await ExternalBookingDialog.open(page, testInfo)
  await second.fill({ patientId: patient.id, typeId: type.id, time: '11:00' })
  await press(second.submit, testInfo)
  await expect(second.alert).toHaveText(DUPLICATE_BOOKING)
  await expect(second.dialog).toBeVisible()
  await expect(second.submit).toBeEnabled()
  await expect(second.submit).toHaveAccessibleName('Book appointment')
  await expect(second.time).toHaveValue('11:00')
  await expectNoLeakedNulls(page, { scope: second.dialog })
  expect(await appointmentsOf(patient.id)).toHaveLength(1)
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

/**
 * Hold the first router refresh (an RSC GET that is not a prefetch) so the state between a
 * refusal and the refreshed page can be asserted without racing it.
 */
async function holdNextRefresh(page: Page) {
  let held = false
  let open!: () => void
  const gate = new Promise<void>((resolve) => { open = resolve })
  const isRefresh = (request: Request) => {
    const headers = request.headers()
    return request.method() === 'GET' && headers['rsc'] === '1' && headers['next-router-prefetch'] === undefined
  }
  const handler = async (route: Route) => {
    if (held || !isRefresh(route.request())) {
      await route.fallback()
      return
    }
    held = true
    await gate
    await route.fallback().catch(() => {})
  }
  await page.route(() => true, handler)
  return {
    held: () => held,
    async release() {
      open()
      await page.unroute(() => true, handler).catch(() => {})
    },
  }
}

test('a booking submitted after the admin revoked the patient closes the dialog and shows the access notice', async ({ page, factory }, testInfo) => {
  const user = await factory.createAuthUser({ clinicId: CLINIC_A.id, role: 'external_staff' })
  const patient = await factory.createPatient({ phone: null })
  await factory.shareWithExternal(patient.id, [user.id])
  const type = await factory.findAppointmentType(true)
  const guards = guardsFor(page)
  await signInWithMobile(page, { mobileNumber: user.mobileNumber })
  await page.goto(`/external?date=${clinicDate(4)}`)

  const booking = await ExternalBookingDialog.open(page, testInfo)
  // The only shared patient is preselected.
  await expect(booking.patient).toHaveValue(patient.id)
  await booking.fill({ typeId: type.id, time: '12:00' })

  // The admin takes the patient back while the dialog is open.
  await factory.shareWithExternal(patient.id, [])
  const refresh = await holdNextRefresh(page)
  await press(booking.submit, testInfo)
  await expect(booking.dialog).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: EXTERNAL_ACCESS_MESSAGE })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New appointment', exact: true })).toBeDisabled()
  await expect.poll(() => refresh.held(), { message: 'the access refusal should refresh the workspace' }).toBe(true)

  await refresh.release()
  await expect(page.getByText('No patients have been shared', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New appointment', exact: true })).toBeDisabled()
  await page.reload()
  await expect(page.getByText('No patients have been shared', { exact: true })).toBeVisible()
  await expect(page.getByText(patient.name, { exact: false })).toHaveCount(0)
  await expectNoLeakedNulls(page)
  expect(await appointmentsOf(patient.id)).toEqual([])
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('saving or cancelling an appointment the clinic completed meanwhile says it can no longer be changed', async ({ page, factory }, testInfo) => {
  const { patient, type } = await sharedPatient(factory)
  const date = clinicDate(7)
  const booked = await factory.createExternalBooking({ patientId: patient.id, date, time: '13:00', appointmentTypeId: type.id })
  const guards = guardsFor(page)
  await page.goto(`/external?date=${date}`)
  const dialog = await ExternalAppointmentDialog.open(page, testInfo, patient.name)

  await factory.updateAppointment(booked.id, { status: 'completed' })
  await dialog.duration.fill('50')
  await press(dialog.save, testInfo)
  await expect(dialog.alert).toHaveText(NO_LONGER_CHANGEABLE)
  await expect(dialog.save).toBeEnabled()
  await expect(dialog.save).toHaveAccessibleName('Save changes')
  await expect(dialog.duration).toHaveValue('50')

  await press(dialog.startCancel, testInfo)
  await expect(dialog.keep).toBeVisible()
  await press(dialog.confirmCancel, testInfo)
  await expect(dialog.alert).toHaveText(NO_LONGER_CHANGEABLE)
  await expect(dialog.confirmCancel).toBeEnabled()
  await expect(dialog.confirmCancel).toHaveAccessibleName('Cancel appointment')
  await expect(dialog.keep).toBeEnabled()
  await expectNoLeakedNulls(page, { scope: dialog.dialog })

  const [row] = await appointmentsOf(patient.id)
  expect(row).toMatchObject({ id: booked.id, status: 'completed', date, time: '13:00:00', duration_minutes: 45 })
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('past and completed External Staff appointments open read-only, and a booking without a time sends nothing', async ({ page }, testInfo) => {
  const guards = guardsFor(page)
  let actions = 0
  page.on('request', (request) => { if (isServerActionRequest(request)) actions += 1 })
  const name = SPARSE_NAMES.patientExternal

  await page.goto(`/external?date=${clinicDate(-1)}`)
  const past = await ExternalAppointmentDialog.open(page, testInfo, name)
  await expect(past.dialog.getByText('Past appointments can’t be changed. Contact your clinic admin if something is wrong.', { exact: true })).toBeVisible()
  await expect(past.dialog.getByText('Scheduled', { exact: false })).toBeVisible()
  await expect(past.save).toHaveCount(0)
  await expect(past.startCancel).toHaveCount(0)
  await expect(past.date).toHaveCount(0)
  await expectNoLeakedNulls(page, { scope: past.dialog })
  await page.keyboard.press('Escape')
  await expect(past.dialog).toBeHidden()

  await page.goto(`/external?date=${clinicDate(-2)}`)
  const completed = await ExternalAppointmentDialog.open(page, testInfo, name)
  await expect(completed.dialog.getByText('This appointment is completed and can’t be changed.', { exact: true })).toBeVisible()
  await expect(completed.save).toHaveCount(0)
  await expect(completed.startCancel).toHaveCount(0)
  await expectNoLeakedNulls(page, { scope: completed.dialog })
  await page.keyboard.press('Escape')

  // Time is required: the browser refuses the submit itself, so the dialog's own
  // "Choose a valid date and time." copy is never reached and nothing is sent.
  await page.goto(`/external?date=${clinicDate(3)}`)
  const booking = await ExternalBookingDialog.open(page, testInfo)
  const type = (await adminClient().from('appointment_types').select('id').eq('clinic_id', CLINIC_A.id).eq('is_shared', true).limit(1).single()).data!
  await booking.fill({ typeId: type.id })
  await booking.patient.selectOption({ index: 1 })
  const sentBefore = actions
  await press(booking.submit, testInfo)
  await expect(booking.dialog).toBeVisible()
  await expect.poll(() => booking.time.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true)
  expect(await booking.time.evaluate((input: HTMLInputElement) => input.validationMessage)).not.toBe('')
  await expect(booking.submit).toBeEnabled()
  await expect(booking.submit).toHaveAccessibleName('Book appointment')
  expect(actions).toBe(sentBefore)
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('a dropped booking request shows the booking copy and the retry books once with the same key', async ({ page, factory }, testInfo) => {
  const { patient, type } = await sharedPatient(factory)
  const sent = recordBookingIds(page)
  const guards = guardsFor(page)
  await page.goto(`/external?date=${clinicDate(5)}`)
  const booking = await ExternalBookingDialog.open(page, testInfo)
  await booking.fill({ patientId: patient.id, typeId: type.id, time: '14:00' })

  const fault = await failNextServerAction(page, 'abort')
  await press(booking.submit, testInfo)
  await expectButtonRecovers(booking.submit, { idleName: 'Book appointment', message: BOOKING_UNCONFIRMED, fault })
  await expect(booking.dialog).toBeVisible()
  await expect(booking.time).toHaveValue('14:00')
  expect(await appointmentsOf(patient.id)).toEqual([])
  expect(fault.hits()).toBe(1)

  await fault.dispose()
  await press(booking.submit, testInfo)
  await expect(booking.dialog).toBeHidden()
  await expect(page.getByText('Appointment booked', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect.poll(async () => (await appointmentsOf(patient.id)).length).toBe(1)
  // The retry carried the same idempotency key as the dropped attempt.
  expect(sent).toHaveLength(2)
  expect(sent[1]).toBe(sent[0])
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('a booking whose reply was lost is not booked twice when retried', async ({ page, factory }, testInfo) => {
  const { patient, type } = await sharedPatient(factory)
  const guards = guardsFor(page)
  await page.goto(`/external?date=${clinicDate(5)}`)
  const booking = await ExternalBookingDialog.open(page, testInfo)
  await booking.fill({ patientId: patient.id, typeId: type.id, time: '15:00' })

  const fault = await failNextServerAction(page, 'lost-response')
  await press(booking.submit, testInfo)
  await expectButtonRecovers(booking.submit, { idleName: 'Book appointment', message: BOOKING_UNCONFIRMED, fault })
  // The server committed before the reply was lost.
  expect(await appointmentsOf(patient.id)).toHaveLength(1)

  await fault.dispose()
  await press(booking.submit, testInfo)
  await expect(booking.dialog).toBeHidden()
  await expect(page.getByText('Appointment booked', { exact: true }).filter({ visible: true })).toBeVisible()
  expect(await appointmentsOf(patient.id)).toHaveLength(1)
  await expect(scheduleChip(page, patient.name)).toHaveCount(1)
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('a failed Save changes or Cancel appointment shows the change copy and leaves the dialog usable', async ({ page, factory }, testInfo) => {
  const { patient, type } = await sharedPatient(factory)
  const date = clinicDate(8)
  const booked = await factory.createExternalBooking({ patientId: patient.id, date, time: '16:00', appointmentTypeId: type.id })
  const guards = guardsFor(page)
  await page.goto(`/external?date=${date}`)
  const dialog = await ExternalAppointmentDialog.open(page, testInfo, patient.name)
  const unchanged = { id: booked.id, status: 'scheduled', date, time: '16:00:00', duration_minutes: 45 }

  for (const mode of ['abort', 'http-500'] as const) {
    await dialog.duration.fill('55')
    const fault = await failNextServerAction(page, mode)
    await press(dialog.save, testInfo)
    await expectButtonRecovers(dialog.save, { idleName: 'Save changes', message: CHANGE_UNCONFIRMED, fault })
    await expect(dialog.duration).toHaveValue('55')
    await expect(dialog.startCancel).toBeEnabled()
    expect((await appointmentsOf(patient.id))[0]).toMatchObject(unchanged)
    await fault.dispose()
  }

  await press(dialog.startCancel, testInfo)
  for (const mode of ['abort', 'http-500'] as const) {
    const fault = await failNextServerAction(page, mode)
    await press(dialog.confirmCancel, testInfo)
    await expectButtonRecovers(dialog.confirmCancel, { idleName: 'Cancel appointment', message: CHANGE_UNCONFIRMED, fault })
    await expect(dialog.keep).toBeEnabled()
    expect((await appointmentsOf(patient.id))[0]).toMatchObject(unchanged)
    await fault.dispose()
  }

  // Back out of the cancellation; the same dialog still saves.
  await press(dialog.keep, testInfo)
  await dialog.duration.fill('55')
  await press(dialog.save, testInfo)
  await expect(dialog.dialog).toBeHidden()
  await expect(page.getByText('Appointment updated', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect.poll(async () => (await appointmentsOf(patient.id))[0].duration_minutes).toBe(55)
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('a held booking, save or cancel shows its pending label, locks the dialog and sends one request', async ({ page, factory }, testInfo) => {
  const { patient, type } = await sharedPatient(factory)
  const date = clinicDate(9)
  const guards = guardsFor(page)
  await page.goto(`/external?date=${date}`)

  // Book.
  const booking = await ExternalBookingDialog.open(page, testInfo)
  await booking.fill({ patientId: patient.id, typeId: type.id, time: '17:00' })
  let hold = await holdNextServerAction(page)
  await press(booking.submit, testInfo)
  await hold.whenHeld()
  await expect(booking.submit).toHaveAccessibleName('Booking…')
  await expect(booking.submit).toBeDisabled()
  await expect(booking.time).toBeDisabled()
  await expect(booking.cancel).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(booking.dialog).toBeVisible()
  await booking.submit.click({ force: true })
  await page.keyboard.press('Enter')
  expect(hold.count()).toBe(1)
  await hold.release()
  await expect(booking.dialog).toBeHidden()
  expect(hold.count()).toBe(1)
  await expect.poll(async () => (await appointmentsOf(patient.id)).length).toBe(1)

  // Reschedule.
  let dialog = await ExternalAppointmentDialog.open(page, testInfo, patient.name)
  await dialog.duration.fill('40')
  hold = await holdNextServerAction(page)
  await press(dialog.save, testInfo)
  await hold.whenHeld()
  await expect(dialog.save).toHaveAccessibleName('Saving…')
  await expect(dialog.save).toBeDisabled()
  await expect(dialog.duration).toBeDisabled()
  await expect(dialog.startCancel).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog.dialog).toBeVisible()
  await dialog.save.click({ force: true })
  expect(hold.count()).toBe(1)
  await hold.release()
  await expect(dialog.dialog).toBeHidden()
  await expect.poll(async () => (await appointmentsOf(patient.id))[0].duration_minutes).toBe(40)
  // The chip shows the new length as soon as the save returns (G-20).
  await expect(scheduleChip(page, patient.name).filter({ hasText: '40m' })).toBeVisible()

  // Cancel.
  dialog = await ExternalAppointmentDialog.open(page, testInfo, patient.name)
  await press(dialog.startCancel, testInfo)
  hold = await holdNextServerAction(page)
  await press(dialog.confirmCancel, testInfo)
  await hold.whenHeld()
  await expect(dialog.confirmCancel).toHaveAccessibleName('Cancelling…')
  await expect(dialog.confirmCancel).toBeDisabled()
  await expect(dialog.keep).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog.dialog).toBeVisible()
  await dialog.confirmCancel.click({ force: true })
  expect(hold.count()).toBe(1)
  await hold.release()
  await expect(dialog.dialog).toBeHidden()
  await expect.poll(async () => (await appointmentsOf(patient.id))[0].status).toBe('cancelled')
  expect(await appointmentsOf(patient.id)).toHaveLength(1)
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

// G-20 (was NEW-X1): the dialog's appointment used to come only from the page's workspace, which
// is replaced when router.refresh() lands. Reopened in that window, the dialog held the old slot,
// and Cancel restates it exactly, so the server refused it with "These appointment details could
// not be saved…". The page now shows the row the save returned until the refresh arrives. The
// refresh is held here so the window is deterministic.
test('cancelling right after a reschedule, before the screen refreshes, cancels the appointment', async ({ page, factory }, testInfo) => {
  const { patient, type } = await sharedPatient(factory)
  const date = clinicDate(11)
  await factory.createExternalBooking({ patientId: patient.id, date, time: '18:00', appointmentTypeId: type.id })
  const guards = guardsFor(page)
  await page.goto(`/external?date=${date}`)
  let dialog = await ExternalAppointmentDialog.open(page, testInfo, patient.name)
  await dialog.duration.fill('50')
  const refresh = await holdNextRefresh(page)
  try {
    await press(dialog.save, testInfo)
    await expect(dialog.dialog).toBeHidden()
    await expect(page.getByText('Appointment updated', { exact: true }).filter({ visible: true })).toBeVisible()
    await expect.poll(async () => (await appointmentsOf(patient.id))[0].duration_minutes).toBe(50)

    // The chip already shows the saved length although the refresh is still held.
    await expect(scheduleChip(page, patient.name).filter({ hasText: '50m' })).toBeVisible()
    dialog = await ExternalAppointmentDialog.open(page, testInfo, patient.name)
    await expect(dialog.duration).toHaveValue('50')
    await press(dialog.startCancel, testInfo)
    await press(dialog.confirmCancel, testInfo)
    await expect(dialog.dialog).toBeHidden()
    await expect.poll(async () => (await appointmentsOf(patient.id))[0].status).toBe('cancelled')
  } finally {
    await refresh.release()
  }
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})
