// S-18: the audited "Adjust fee" on a completed appointment (admin, desktop + mobile).
//
// The control is one responsive DOM, but the plan runs it on both viewports because the dialog
// is a full-width sheet on the phone.

import type { Page } from '@playwright/test'
import { AppointmentDetail } from '../pages/appointment-detail'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { expandAllDateGroups } from '../support/date-groups'
import { test, expect, type E2EFactory } from '../support/factories'
import {
  ACTION_UNREACHABLE_MESSAGE,
  expectButtonRecovers,
  expectedFaultConsoleErrors,
  failNextServerAction,
  holdNextServerAction,
} from '../support/fault-injection'

test.use({ serviceWorkers: 'block' })

function guardsFor(page: Page) {
  return attachErrorGuards(page, {
    expectedFailures: expectedFaultConsoleErrors('server-action'),
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }],
  })
}

/** A completed, unpaid ₹800 session today, so it counts in "billed this month" and is due. */
async function completedSession(factory: E2EFactory, time: string) {
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({
    patientId: patient.id, date: clinicDate(), time, fee: 800, status: 'completed', payment_status: 'unpaid',
  })
  return { patient, appointment }
}

test('Adjust fee refuses a blank reason, the same fee and a fee of zero or less', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { appointment } = await completedSession(factory, '06:10')
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)

  const { dialog, fee, reason, save } = await detail.openAdjustFee()
  await expect(fee).toHaveValue('800')
  await expect(save).toBeDisabled()

  await reason.fill('   ')
  await fee.fill('650')
  await expect(save, 'a whitespace reason is no reason').toBeDisabled()

  await reason.fill(factory.uniqueName('fee-reason'))
  for (const value of ['800', '0', '-5', '']) {
    await fee.fill(value)
    await expect(save, `fee ${JSON.stringify(value)} must not be savable`).toBeDisabled()
  }
  await fee.fill('650')
  await expect(save).toBeEnabled()
  await expectNoLeakedNulls(page, { scope: dialog })

  expect(await factory.findChargeAdjustments({ appointmentId: appointment.id })).toEqual([])
  await guards.assertClean()
})

test('a valid fee adjustment updates the detail, the billed metric, payment due and the ledger', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { patient, appointment } = await completedSession(factory, '06:20')
  const reason = factory.uniqueName('fee-reason')
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  await expect(page.getByText('₹800', { exact: true })).toBeVisible()

  await detail.adjustFee(650, reason)
  await expect(page.getByText('₹650', { exact: true })).toBeVisible()
  await expect(page.getByText('₹800', { exact: true })).toHaveCount(0)

  const adjustments = await factory.findChargeAdjustments({ appointmentId: appointment.id })
  expect(adjustments).toHaveLength(1)
  expect(adjustments[0]).toMatchObject({ reason })
  expect(Number((adjustments[0] as Record<string, unknown>).previous_amount)).toBe(800)
  expect(Number((adjustments[0] as Record<string, unknown>).adjusted_amount)).toBe(650)
  const [row] = await factory.findAppointments({ patientId: patient.id })
  expect(Number(row.fee)).toBe(650)

  await page.goto(`/billing/payment-due/${patient.id}`)
  await expect(page.getByRole('main')).toContainText('₹650')
  await expect(page.getByRole('main')).not.toContainText('₹800')
  await expectNoLeakedNulls(page)

  await page.goto('/billing/metrics/billed-this-month')
  await expandAllDateGroups(page)
  const billedRow = page.locator('li, tr, a, div')
    .filter({ hasText: patient.name as string })
    .filter({ hasText: /₹\s?650(?!\d)/ })
    .filter({ visible: true })
  await expect(billedRow.last()).toBeVisible()
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('a scheduled appointment offers no Adjust fee', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(40), time: '06:30' })
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Adjust fee', exact: true })).toHaveCount(0)
  await guards.assertClean()
})

async function openFilledAdjustment(page: Page, factory: E2EFactory, time: string) {
  const { appointment } = await completedSession(factory, time)
  const reason = factory.uniqueName('fee-reason')
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  const { dialog, fee, reason: reasonInput, save } = await detail.openAdjustFee()
  await fee.fill('700')
  await reasonInput.fill(reason)
  return { appointment, reason, dialog, fee, save }
}

async function expectFeeFaultRecovered(
  page: Page,
  factory: E2EFactory,
  input: Awaited<ReturnType<typeof openFilledAdjustment>> & { fault: Awaited<ReturnType<typeof failNextServerAction>> },
) {
  const { appointment, reason, dialog, fee, save, fault } = input
  await save.click()
  await expectButtonRecovers(save, { idleName: 'Save fee adjustment', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(dialog).toBeVisible()
  await expect(fee).toHaveValue('700')
  await expect(dialog.getByLabel('Reason *', { exact: true })).toHaveValue(reason)
  expect(await factory.findChargeAdjustments({ appointmentId: appointment.id })).toEqual([])

  await fault.dispose()
  await save.click()
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await factory.findChargeAdjustments({ appointmentId: appointment.id })).length).toBe(1)
  await expect(page.getByText('₹700', { exact: true })).toBeVisible()
}

test('Save fee adjustment recovers from a dropped connection and saves once on retry', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const opened = await openFilledAdjustment(page, factory, '06:40')
  const fault = await failNextServerAction(page, 'abort')
  await expectFeeFaultRecovered(page, factory, { ...opened, fault })
  await guards.assertClean()
})

test('Save fee adjustment recovers from a server error and saves once on retry', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const opened = await openFilledAdjustment(page, factory, '06:50')
  const fault = await failNextServerAction(page, 'http-500')
  await expectFeeFaultRecovered(page, factory, { ...opened, fault })
  await guards.assertClean()
})

test('a held fee adjustment shows Saving…, cannot be sent twice and saves once released', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { appointment } = await completedSession(factory, '07:00')
  const detail = new AppointmentDetail(page)
  await detail.goto(appointment.id)
  const { dialog, fee, reason, save } = await detail.openAdjustFee()
  await fee.fill('725')
  await reason.fill(factory.uniqueName('fee-reason'))

  const hold = await holdNextServerAction(page)
  await save.click()
  await hold.whenHeld()
  await expect(save).toHaveAccessibleName('Saving…')
  await expect(save).toBeDisabled()
  await save.click({ force: true })
  expect(hold.count()).toBe(1)
  expect(await factory.findChargeAdjustments({ appointmentId: appointment.id })).toEqual([])

  await hold.release()
  await expect(dialog).toBeHidden()
  expect(hold.count()).toBe(1)
  await expect.poll(async () => (await factory.findChargeAdjustments({ appointmentId: appointment.id })).length).toBe(1)
  await guards.assertClean()
})
