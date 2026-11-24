// Billing writes that fail (plan 5.3, B-7 … B-11): a refused save, an audited change made stale by
// another screen, and the standard failure triple (dropped connection, server error, request held
// in flight) on every billing server action. In each case the message is shown, the control comes
// back usable with the typed input kept, and the database holds exactly what it should.
//
// Phones only (decision D2): the entry dialog and the audited-change dialog are one DOM on both
// viewports, so the desktop project would repeat the same control. The row triggers that do differ
// per viewport are covered on both by billing-packages.spec.ts (B-5).

import type { Page } from '@playwright/test'
import {
  BillingEntryForm,
  auditSaveButton,
  isServerActionPost,
  openAuditDialog,
  openBillingTab,
  packageCancelButton,
  paymentActionButton,
  reverseRefundButton,
} from '../pages/billing-entry-form'
import { attachErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect, type E2EFactory } from '../support/factories'
import {
  ACTION_UNREACHABLE_MESSAGE,
  expectButtonRecovers,
  expectFailureMessage,
  expectedFaultConsoleErrors,
  failNextServerAction,
  holdNextServerAction,
} from '../support/fault-injection'
import { isMobileProject } from '../support/mobile'
import { adminClient } from '../support/supabase-admin'

// Faults must reach Playwright's router, not the service worker.
test.use({ serviceWorkers: 'block' })

test.beforeEach(({}, testInfo) => {
  test.skip(!isMobileProject(testInfo), 'D2: same dialog DOM on both viewports; failure cases run on the phone')
})

function guardsFor(page: Page) {
  return attachErrorGuards(page, {
    expectedFailures: expectedFaultConsoleErrors('server-action'),
    // reportClientError's telemetry budget can answer 429 when the matrix runs back to back.
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }],
  })
}

const db = () => adminClient()

async function paymentRows(patientId: string) {
  const { data, error } = await db().from('payments').select('id, amount, notes, status').eq('patient_id', patientId)
  expect(error).toBeNull()
  return data ?? []
}

async function packageRows(patientId: string) {
  const { data, error } = await db().from('packages').select('id, name, status').eq('patient_id', patientId)
  expect(error).toBeNull()
  return data ?? []
}

async function statusOf(table: 'payments' | 'packages', id: string) {
  const { data, error } = await db().from(table).select('status').eq('id', id).single()
  expect(error).toBeNull()
  return data!.status as string
}

async function reversalsOf(refundId: string) {
  const { data, error } = await db().from('refund_reversals').select('id').eq('refund_id', refundId)
  expect(error).toBeNull()
  return data ?? []
}

/** The entry dialog with a payment typed in and the patient's preview already loaded. */
async function openPaymentEntry(page: Page, factory: E2EFactory, amount = '640') {
  const patient = await factory.createPatient({ phone: null })
  const notes = factory.uniqueName('failing-payment')
  factory.watchUiPayment({ patientId: patient.id, notes })
  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()
  await form.fillPaymentOnly({ patientName: patient.name as string, amount, notes }, { waitForPreview: true })
  return { patient, notes, form, amount, save: form.saveButton('payment') }
}

async function openPackageEntry(page: Page, factory: E2EFactory) {
  const patient = await factory.createPatient({ phone: null })
  const packageName = factory.uniqueName('failing-package')
  factory.watchUiPackage({ patientId: patient.id, name: packageName })
  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()
  await form.fillPackageManual({ patientName: patient.name as string, packageName, sessions: '4', rate: '650' }, { waitForPreview: true })
  return { patient, packageName, form, save: form.saveButton('package') }
}

/** A posted receipt dated today and its audited dialog, reason typed. */
async function openPaymentAudit(page: Page, factory: E2EFactory, kind: 'Cancel payment' | 'Record refund', amount: number) {
  const patient = await factory.createPatient({ phone: null })
  const payment = await factory.createPayment({ patientId: patient.id, amount, date: clinicDate() })
  await page.goto('/billing?tab=payments')
  await openBillingTab(page, 'Payments')
  const trigger = paymentActionButton(page, kind === 'Cancel payment' ? 'Cancel' : 'Refund', patient.name as string, amount)
  const dialog = await openAuditDialog(page, trigger, kind)
  const reason = factory.uniqueName('audit-reason')
  await dialog.getByLabel('Reason *', { exact: true }).fill(reason)
  return { patient, payment, dialog, reason, save: auditSaveButton(dialog) }
}

async function openReverseRefund(page: Page, factory: E2EFactory) {
  const patient = await factory.createPatient({ phone: null })
  const payment = await factory.createPayment({ patientId: patient.id, amount: 960, date: clinicDate() })
  const refundReason = factory.uniqueName('refund-to-reverse')
  const refund = await factory.createRefund({ paymentId: payment.id as string, amount: 310, reason: refundReason })
  await page.goto('/billing?tab=payments')
  await openBillingTab(page, 'Payments')
  const dialog = await openAuditDialog(page, reverseRefundButton(page, refundReason, 310), 'Reverse refund')
  const reason = factory.uniqueName('reverse-reason')
  await dialog.getByLabel('Reason *', { exact: true }).fill(reason)
  return { patient, payment, refund, dialog, reason, save: auditSaveButton(dialog) }
}

async function openCancelPackage(page: Page, factory: E2EFactory) {
  const patient = await factory.createPatient({ phone: null })
  const pkg = await factory.createPackage({
    patientId: patient.id, name: factory.uniqueName('package-to-cancel'), total_amount: 2600, per_session_amount: 650, paid_amount: 2600,
  })
  await factory.createPayment({ patientId: patient.id, package_id: pkg.id, amount: 2600 })
  await page.goto('/billing?tab=packages')
  await openBillingTab(page, 'Packages')
  const dialog = await openAuditDialog(page, packageCancelButton(page, patient.name as string, pkg.name as string), 'Cancel package')
  const reason = factory.uniqueName('cancel-reason')
  await dialog.getByLabel('Reason *', { exact: true }).fill(reason)
  return { patient, pkg, dialog, reason, save: auditSaveButton(dialog) }
}

async function expectAuditSaved(page: Page, dialog: import('@playwright/test').Locator) {
  await expect(page.getByText('Audited change saved', { exact: true }).first()).toBeVisible()
  await expect(dialog).toBeHidden()
}

// ---------------------------------------------------------------------------------------------
// B-7 · a save the server refuses

test('a payment for a patient deleted while the form is open is refused and keeps the entry', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { patient, notes, form, save } = await openPaymentEntry(page, factory, '515')
  await factory.deletePatientHard(patient.id)

  // The RPC no longer finds the patient; the message says they were deleted (G-27), not that
  // they belong to another clinic.
  await form.submitExpectingError('payment', 'This patient has been deleted, so nothing was recorded. Close the form and choose the patient again.')
  await expect(page.getByText('Selected patient does not belong to your clinic.')).toHaveCount(0)
  await expect(form.amountInput).toHaveValue('515')
  await expect(form.notesInput).toHaveValue(notes)
  await expect(save).toHaveAccessibleName('Save Payment')
  await expect(save).toBeEnabled()
  expect(await paymentRows(patient.id)).toEqual([])
  await guards.assertClean()
})

// ---------------------------------------------------------------------------------------------
// B-8 · an audited change another screen already made

test('cancelling a payment another screen already cancelled is refused and keeps the reason', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { patient, payment, dialog, reason, save } = await openPaymentAudit(page, factory, 'Cancel payment', 845)

  const other = await page.context().newPage()
  await other.goto('/billing?tab=payments')
  await new BillingEntryForm(other).voidPayment(patient.name as string, 845)
  await other.close()
  await expect.poll(() => statusOf('payments', payment.id as string)).toBe('voided')

  await save.tap()
  await expectFailureMessage(page, 'Audited change not saved')
  await expectFailureMessage(page, 'Payment is already voided.')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Reason *', { exact: true })).toHaveValue(reason)
  await expect(save).toHaveAccessibleName('Save audited change')
  await expect(save).toBeEnabled()
  const { data } = await db().from('payments').select('void_reason').eq('id', payment.id).single()
  expect(data?.void_reason).toBe('E2E correction')
  await guards.assertClean()
})

test('cancelling a package another screen already cancelled is refused and keeps the reason', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { patient, pkg, dialog, reason, save } = await openCancelPackage(page, factory)

  const other = await page.context().newPage()
  await other.goto('/billing?tab=packages')
  await new BillingEntryForm(other).cancelPackage(patient.name as string, pkg.name as string)
  await other.close()
  await expect.poll(() => statusOf('packages', pkg.id as string)).toBe('cancelled')

  await save.tap()
  await expectFailureMessage(page, 'Audited change not saved')
  await expectFailureMessage(page, 'Package is already cancelled.')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Reason *', { exact: true })).toHaveValue(reason)
  await expect(save).toHaveAccessibleName('Save audited change')
  await expect(save).toBeEnabled()
  const { data } = await db().from('packages').select('cancellation_reason').eq('id', pkg.id).single()
  expect(data?.cancellation_reason).toBe('E2E package correction')
  await guards.assertClean()
})

test('a refund above what another screen left refundable is refused and keeps the input', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { payment, dialog, reason, save } = await openPaymentAudit(page, factory, 'Record refund', 1000)
  await dialog.getByLabel('Amount *', { exact: true }).fill('500')

  // Elsewhere ₹700 is refunded first, leaving only ₹300.
  await factory.createRefund({ paymentId: payment.id as string, amount: 700 })

  await save.tap()
  await expectFailureMessage(page, 'Audited change not saved')
  await expectFailureMessage(page, 'Refund exceeds the unrefunded payment amount.')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Amount *', { exact: true })).toHaveValue('500')
  await expect(dialog.getByLabel('Reason *', { exact: true })).toHaveValue(reason)
  await expect(save).toBeEnabled()
  expect((await factory.findRefunds({ paymentId: payment.id as string })).map((refund) => Number(refund.amount))).toEqual([700])
  await guards.assertClean()
})

// ---------------------------------------------------------------------------------------------
// B-9 · the failure triple on every billing action

test('Save Payment: a dropped connection keeps the entry, saves nothing, and the retry saves once', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { patient, notes, form, amount, save } = await openPaymentEntry(page, factory)

  const fault = await failNextServerAction(page, 'abort')
  await save.tap()
  await expectButtonRecovers(save, { idleName: 'Save Payment', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(form.dialog).toBeVisible()
  await expect(form.amountInput).toHaveValue(amount)
  await expect(form.notesInput).toHaveValue(notes)
  expect(await paymentRows(patient.id)).toEqual([])
  expect(fault.hits()).toBe(1)

  await fault.dispose()
  await save.tap()
  await expect(form.dialog).toBeHidden()
  await expect(page.getByText('Payment recorded', { exact: true })).toBeVisible()
  await expect.poll(async () => (await paymentRows(patient.id)).length).toBe(1)
  await guards.assertClean()
})

test('Save Payment: a server error keeps the entry, saves nothing, and the retry saves once', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { patient, notes, form, amount, save } = await openPaymentEntry(page, factory)

  const fault = await failNextServerAction(page, 'http-500')
  await save.tap()
  await expectButtonRecovers(save, { idleName: 'Save Payment', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(form.amountInput).toHaveValue(amount)
  await expect(form.notesInput).toHaveValue(notes)
  expect(await paymentRows(patient.id)).toEqual([])

  await fault.dispose()
  await save.tap()
  await expect(form.dialog).toBeHidden()
  await expect.poll(async () => (await paymentRows(patient.id)).length).toBe(1)
  await guards.assertClean()
})

test('Save Payment: while the save is in flight a second tap or Enter sends nothing', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { patient, form, save } = await openPaymentEntry(page, factory)

  const hold = await holdNextServerAction(page)
  await save.tap()
  await hold.whenHeld()
  await expect(save).toHaveAccessibleName('Saving...')
  await expect(save).toBeDisabled()
  await save.tap({ force: true })
  await form.amountInput.press('Enter')
  expect(hold.count()).toBe(1)
  expect(await paymentRows(patient.id)).toEqual([])

  await hold.release()
  await expect(form.dialog).toBeHidden()
  await expect(page.getByText('Payment recorded', { exact: true })).toBeVisible()
  expect(hold.count()).toBe(1)
  await expect.poll(async () => (await paymentRows(patient.id)).length).toBe(1)
  await guards.assertClean()
})

test('Save Package: a dropped connection keeps the package, saves nothing, and the retry saves once', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { patient, packageName, form, save } = await openPackageEntry(page, factory)

  const fault = await failNextServerAction(page, 'abort')
  await save.tap()
  await expectButtonRecovers(save, { idleName: 'Save Package', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(form.dialog.getByLabel('Package Name *', { exact: true })).toHaveValue(packageName)
  await expect(form.amountInput).toHaveValue('2600')
  expect(await packageRows(patient.id)).toEqual([])
  expect(await paymentRows(patient.id)).toEqual([])

  await fault.dispose()
  await save.tap()
  await expect(form.dialog).toBeHidden()
  await expect(page.getByText('Package saved', { exact: true })).toBeVisible()
  await expect.poll(async () => (await packageRows(patient.id)).map((row) => row.name)).toEqual([packageName])
  expect(await paymentRows(patient.id)).toHaveLength(1)
  await guards.assertClean()
})

test('Save Package: while the save is in flight a second tap or Enter sends nothing', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { patient, packageName, form, save } = await openPackageEntry(page, factory)

  const hold = await holdNextServerAction(page)
  await save.tap()
  await hold.whenHeld()
  await expect(save).toHaveAccessibleName('Saving...')
  await expect(save).toBeDisabled()
  await save.tap({ force: true })
  await form.dialog.getByLabel('Package Name *', { exact: true }).press('Enter')
  expect(hold.count()).toBe(1)
  expect(await packageRows(patient.id)).toEqual([])

  await hold.release()
  await expect(form.dialog).toBeHidden()
  expect(hold.count()).toBe(1)
  await expect.poll(async () => (await packageRows(patient.id)).map((row) => row.name)).toEqual([packageName])
  await guards.assertClean()
})

test('Cancel payment: a dropped connection keeps the reason, changes nothing, and the retry cancels it', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { payment, dialog, reason, save } = await openPaymentAudit(page, factory, 'Cancel payment', 735)

  const fault = await failNextServerAction(page, 'abort')
  await save.tap()
  await expectButtonRecovers(save, { idleName: 'Save audited change', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Reason *', { exact: true })).toHaveValue(reason)
  expect(await statusOf('payments', payment.id as string)).toBe('posted')

  await fault.dispose()
  await save.tap()
  await expectAuditSaved(page, dialog)
  await expect.poll(() => statusOf('payments', payment.id as string)).toBe('voided')
  await guards.assertClean()
})

test('Cancel payment: while the change is in flight a second tap sends nothing', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { payment, dialog, save } = await openPaymentAudit(page, factory, 'Cancel payment', 736)

  const hold = await holdNextServerAction(page)
  await save.tap()
  await hold.whenHeld()
  await expect(save).toHaveAccessibleName('Saving…')
  await expect(save).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Back', exact: true })).toBeDisabled()
  await save.tap({ force: true })
  await page.keyboard.press('Enter')
  expect(hold.count()).toBe(1)
  expect(await statusOf('payments', payment.id as string)).toBe('posted')

  await hold.release()
  await expectAuditSaved(page, dialog)
  expect(hold.count()).toBe(1)
  await expect.poll(() => statusOf('payments', payment.id as string)).toBe('voided')
  await guards.assertClean()
})

test('Record refund: a dropped connection keeps the input, refunds nothing, and the retry refunds once', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { payment, dialog, reason, save } = await openPaymentAudit(page, factory, 'Record refund', 1100)
  await dialog.getByLabel('Amount *', { exact: true }).fill('300')

  const fault = await failNextServerAction(page, 'abort')
  await save.tap()
  await expectButtonRecovers(save, { idleName: 'Save audited change', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(dialog.getByLabel('Amount *', { exact: true })).toHaveValue('300')
  await expect(dialog.getByLabel('Reason *', { exact: true })).toHaveValue(reason)
  expect(await factory.findRefunds({ paymentId: payment.id as string })).toEqual([])

  await fault.dispose()
  await save.tap()
  await expectAuditSaved(page, dialog)
  await expect.poll(async () => (await factory.findRefunds({ paymentId: payment.id as string })).map((refund) => Number(refund.amount))).toEqual([300])
  await guards.assertClean()
})

test('Record refund: while the refund is in flight a second tap sends nothing', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { payment, dialog, save } = await openPaymentAudit(page, factory, 'Record refund', 1101)
  await dialog.getByLabel('Amount *', { exact: true }).fill('301')

  const hold = await holdNextServerAction(page)
  await save.tap()
  await hold.whenHeld()
  await expect(save).toHaveAccessibleName('Saving…')
  await expect(save).toBeDisabled()
  await save.tap({ force: true })
  await dialog.getByLabel('Amount *', { exact: true }).press('Enter')
  expect(hold.count()).toBe(1)
  expect(await factory.findRefunds({ paymentId: payment.id as string })).toEqual([])

  await hold.release()
  await expectAuditSaved(page, dialog)
  expect(hold.count()).toBe(1)
  await expect.poll(async () => (await factory.findRefunds({ paymentId: payment.id as string })).length).toBe(1)
  await guards.assertClean()
})

test('Reverse refund: a dropped connection keeps the reason, reverses nothing, and the retry reverses once', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { refund, dialog, reason, save } = await openReverseRefund(page, factory)

  const fault = await failNextServerAction(page, 'abort')
  await save.tap()
  await expectButtonRecovers(save, { idleName: 'Save audited change', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(dialog.getByLabel('Reason *', { exact: true })).toHaveValue(reason)
  expect(await reversalsOf(refund.id)).toEqual([])

  await fault.dispose()
  await save.tap()
  await expectAuditSaved(page, dialog)
  await expect.poll(async () => (await reversalsOf(refund.id)).length).toBe(1)
  await guards.assertClean()
})

test('Reverse refund: while the reversal is in flight a second tap sends nothing', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { refund, dialog, save } = await openReverseRefund(page, factory)

  const hold = await holdNextServerAction(page)
  await save.tap()
  await hold.whenHeld()
  await expect(save).toHaveAccessibleName('Saving…')
  await expect(save).toBeDisabled()
  await save.tap({ force: true })
  expect(hold.count()).toBe(1)
  expect(await reversalsOf(refund.id)).toEqual([])

  await hold.release()
  await expectAuditSaved(page, dialog)
  expect(hold.count()).toBe(1)
  await expect.poll(async () => (await reversalsOf(refund.id)).length).toBe(1)
  await guards.assertClean()
})

test('Cancel package: a dropped connection keeps the reason, changes nothing, and the retry cancels it', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { pkg, dialog, reason, save } = await openCancelPackage(page, factory)

  const fault = await failNextServerAction(page, 'abort')
  await save.tap()
  await expectButtonRecovers(save, { idleName: 'Save audited change', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect(dialog.getByLabel('Reason *', { exact: true })).toHaveValue(reason)
  expect(await statusOf('packages', pkg.id as string)).toBe('active')

  await fault.dispose()
  await save.tap()
  await expectAuditSaved(page, dialog)
  await expect.poll(() => statusOf('packages', pkg.id as string)).toBe('cancelled')
  await guards.assertClean()
})

test('Cancel package: while the change is in flight a second tap sends nothing', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { pkg, dialog, save } = await openCancelPackage(page, factory)

  const hold = await holdNextServerAction(page)
  await save.tap()
  await hold.whenHeld()
  await expect(save).toHaveAccessibleName('Saving…')
  await expect(save).toBeDisabled()
  await save.tap({ force: true })
  expect(hold.count()).toBe(1)
  expect(await statusOf('packages', pkg.id as string)).toBe('active')

  await hold.release()
  await expectAuditSaved(page, dialog)
  expect(hold.count()).toBe(1)
  await expect.poll(() => statusOf('packages', pkg.id as string)).toBe('cancelled')
  await guards.assertClean()
})

// ---------------------------------------------------------------------------------------------
// B-10 · a lost reply, and a double click

test('Save Payment: a lost reply saves exactly once, says to check, and the payment is listed after reload', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { patient, save } = await openPaymentEntry(page, factory, '655')

  const fault = await failNextServerAction(page, 'lost-response')
  await save.tap()
  // "…refresh to see whether it went through before trying again."
  await expectButtonRecovers(save, { idleName: 'Save Payment', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expect.poll(async () => (await paymentRows(patient.id)).length).toBe(1)
  await fault.dispose()

  await page.goto('/billing?tab=payments')
  await openBillingTab(page, 'Payments')
  const row = paymentActionButton(page, 'Cancel', patient.name as string, 655)
  if (!(await row.isVisible())) await page.getByRole('button', { name: /^View more \(\d+ more\)$/ }).click()
  await expect(row).toBeVisible()
  expect(await paymentRows(patient.id)).toHaveLength(1)
  await guards.assertClean()
})

// G-14: `loading` is set only after React commits, so a fast double activation used to record the
// payment twice; a synchronous guard and a request id now stop it. The plan asks for a real
// double click here; M-9 does the same-task double tap.
test('Save Payment: a double click records one payment', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const { patient, form, save } = await openPaymentEntry(page, factory, '665')
  const saves: string[] = []
  page.on('request', (request) => { if (isServerActionPost(request)) saves.push(request.url()) })

  await save.dblclick()
  await expect(form.dialog).toBeHidden()
  await expect(page.getByText('Payment recorded', { exact: true })).toBeVisible()
  expect(saves).toHaveLength(1)
  await expect.poll(async () => (await paymentRows(patient.id)).length).toBe(1)
  await guards.assertClean()
})

// ---------------------------------------------------------------------------------------------
// B-11 · the outstanding-charges preview fails

test('a dropped outstanding-charges preview shows an inline error and Save still works', async ({ page, factory }) => {
  const guards = guardsFor(page)
  const patient = await factory.createPatient({ phone: null })
  await factory.createAppointment({
    patientId: patient.id, date: clinicDate(-3), time: '09:25', fee: 800, status: 'completed', payment_status: 'unpaid',
  })
  const notes = factory.uniqueName('preview-failed')
  factory.watchUiPayment({ patientId: patient.id, notes })
  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()

  // The preview is the first server action the form sends: it fires on the patient pick.
  const fault = await failNextServerAction(page, 'abort')
  await form.fillPaymentOnly({ patientName: patient.name as string, amount: '500', notes })
  const preview = form.dialog.getByTestId('allocation-preview')
  await expect(preview).toContainText(ACTION_UNREACHABLE_MESSAGE)
  await expect(preview.getByText('Working out which sessions this covers…')).toHaveCount(0)
  expect(fault.hits()).toBe(1)
  await fault.dispose()

  await form.saveButton('payment').tap()
  await expect(form.dialog).toBeHidden()
  await expect(page.getByText('Payment recorded', { exact: true })).toBeVisible()
  await expect.poll(async () => (await paymentRows(patient.id)).map((row) => [Number(row.amount), row.notes])).toEqual([[500, notes]])
  await guards.assertClean()
})
