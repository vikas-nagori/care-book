// B-6. Billing input the clinic must not be able to save: every refusal keeps the dialog open and
// writes nothing. Most fields are stopped by the browser's own constraint validation (required,
// min), so each case proves the field is the invalid one and that no save request left the page;
// the refund dialog disables its save, and a cleared refund date is refused by the server.

import type { Locator, Page } from '@playwright/test'
import {
  BillingEntryForm,
  auditSaveButton,
  isServerActionPost,
  openAuditDialog,
  openBillingTab,
  paymentActionButton,
} from '../pages/billing-entry-form'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'
import { expectFailureMessage } from '../support/fault-injection'
import { adminClient } from '../support/supabase-admin'

/** Counts the server actions sent from now on (the preview has already run). */
function countActions(page: Page): () => number {
  let count = 0
  page.on('request', (request) => { if (isServerActionPost(request)) count += 1 })
  return () => count
}

async function expectBlockedByBrowser(field: Locator, flag: 'valueMissing' | 'rangeUnderflow'): Promise<void> {
  await expect.poll(() => field.evaluate((input: HTMLInputElement, key) => input.validity[key], flag)).toBe(true)
  expect(await field.evaluate((input: HTMLInputElement) => input.form?.checkValidity())).toBe(false)
}

async function expectNoPaymentRows(patientId: string): Promise<void> {
  const { data, error } = await adminClient().from('payments').select('id').eq('patient_id', patientId)
  expect(error).toBeNull()
  expect(data).toEqual([])
}

test('Save stays disabled until a patient is chosen', async ({ page }) => {
  const guards = attachErrorGuards(page)
  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()
  await expect(form.saveButton('payment')).toBeDisabled()
  await form.amountInput.fill('500')
  await expect(form.saveButton('payment')).toBeDisabled()
  await form.switchToPackage()
  await expect(form.saveButton('package')).toBeDisabled()
  await expectNoLeakedNulls(page, { scope: form.dialog })
  await guards.assertClean()
})

test('a blank, zero or negative payment amount is stopped and nothing is saved', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient({ phone: null })
  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()
  await form.selectPatientAndWaitForPreview(patient.name as string)
  const actions = countActions(page)
  const save = form.saveButton('payment')

  for (const [value, flag] of [['', 'valueMissing'], ['0', 'rangeUnderflow'], ['-5', 'rangeUnderflow']] as const) {
    await form.amountInput.fill(value)
    await save.click()
    await expectBlockedByBrowser(form.amountInput, flag)
    await expect(form.dialog).toBeVisible()
    await expect(save).toBeEnabled()
  }
  expect(actions()).toBe(0)
  await expectNoPaymentRows(patient.id)
  await guards.assertClean()
})

test('a cleared payment date is stopped and nothing is saved', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient({ phone: null })
  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()
  await form.selectPatientAndWaitForPreview(patient.name as string)
  await form.amountInput.fill('500')
  await expect(form.dateInput).toHaveValue(clinicDate())
  await form.dateInput.fill('')
  const actions = countActions(page)
  await form.saveButton('payment').click()
  await expectBlockedByBrowser(form.dateInput, 'valueMissing')
  await expect(form.dialog).toBeVisible()
  expect(actions()).toBe(0)
  await expectNoPaymentRows(patient.id)
  await guards.assertClean()
})

test('package sessions 0, a rate of 0 or a blank package name are stopped and nothing is saved', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient({ phone: null })
  const packageName = factory.uniqueName('invalid-package')
  factory.watchUiPackage({ patientId: patient.id, name: packageName })
  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()
  await form.fillPackageManual({ patientName: patient.name as string, packageName, sessions: '4', rate: '500' }, { waitForPreview: true })
  const actions = countActions(page)
  const save = form.saveButton('package')
  const sessions = form.dialog.getByLabel('Sessions *', { exact: true })
  const rate = form.dialog.getByLabel('Per Session *', { exact: true })
  const name = form.dialog.getByLabel('Package Name *', { exact: true })

  await sessions.fill('0')
  await save.click()
  await expectBlockedByBrowser(sessions, 'rangeUnderflow')
  await sessions.fill('4')

  await rate.fill('0')
  await save.click()
  await expectBlockedByBrowser(rate, 'rangeUnderflow')
  await rate.fill('500')

  await name.fill('')
  await save.click()
  await expectBlockedByBrowser(name, 'valueMissing')

  await expect(form.dialog).toBeVisible()
  expect(actions()).toBe(0)
  const { data, error } = await adminClient().from('packages').select('id').eq('patient_id', patient.id)
  expect(error).toBeNull()
  expect(data).toEqual([])
  await expectNoPaymentRows(patient.id)
  await guards.assertClean()
})

async function openRefund(page: Page, factory: import('../support/factories').E2EFactory) {
  const patient = await factory.createPatient({ phone: null })
  const amount = 900
  const payment = await factory.createPayment({ patientId: patient.id, amount, date: clinicDate() })
  await page.goto('/billing?tab=payments')
  await openBillingTab(page, 'Payments')
  const dialog = await openAuditDialog(page, paymentActionButton(page, 'Refund', patient.name as string, amount), 'Record refund')
  return { patient, payment, dialog, save: auditSaveButton(dialog) }
}

test('a refund of 0, above the payment, or with no reason cannot be saved', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const { payment, dialog, save } = await openRefund(page, factory)
  const amount = dialog.getByLabel('Amount *', { exact: true })
  const reason = dialog.getByLabel('Reason *', { exact: true })
  // Opens with the whole refundable amount and no reason.
  await expect(amount).toHaveValue('900')
  await expect(save).toBeDisabled()

  await reason.fill('E2E refund validation')
  await expect(save).toBeEnabled()
  for (const value of ['0', '900.01', '-5']) {
    await amount.fill(value)
    await expect(save).toBeDisabled()
  }
  await amount.fill('300')
  await reason.fill('   ')
  await expect(save).toBeDisabled()
  await expect(dialog).toBeVisible()
  await expectNoLeakedNulls(page, { scope: dialog })
  expect(await factory.findRefunds({ paymentId: payment.id })).toEqual([])
  await guards.assertClean()
})

test('a cleared refund date is refused with "Choose a refund date." and nothing is saved', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const { payment, dialog, save } = await openRefund(page, factory)
  await dialog.getByLabel('Amount *', { exact: true }).fill('300')
  const reason = factory.uniqueName('refund-no-date')
  await dialog.getByLabel('Reason *', { exact: true }).fill(reason)
  await dialog.getByLabel('Date *', { exact: true }).fill('')
  await save.click()
  await expectFailureMessage(page, 'Audited change not saved')
  await expectFailureMessage(page, 'Choose a refund date.')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Reason *', { exact: true })).toHaveValue(reason)
  await expect(save).toHaveAccessibleName('Save audited change')
  await expect(save).toBeEnabled()
  expect(await factory.findRefunds({ paymentId: payment.id })).toEqual([])
  await guards.assertClean()
})
