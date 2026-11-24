// Admin-only minimal-input coverage; see e2e/shared/minimal-input.spec.ts for the rationale.

import {
  BillingEntryForm,
  danglingSeparators,
  findBalanceRow,
  openBillingTab,
  openPatientBillingTab,
  paymentActionButton,
  revealAllRows,
  visitEveryBillingScreen,
} from '../pages/billing-entry-form'
import { SettingsView } from '../pages/settings-view'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'
import { SEED } from '../support/ids'
import { IOS_TAG } from '../support/mobile'
import { adminClient } from '../support/supabase-admin'

const pdfPath = (patientId: string) => `/api/billing/payment-due/${patientId}/pdf`

// B-1. A receipt with no notes, the default method and no sessions to settle: every billing screen
// renders it, its row has no dangling separator, the patient is a Credit row, and a PDF for a
// credit-only patient answers "No payment pending…" without sticking.
test('a payment recorded without notes renders in billing and on the patient', { tag: IOS_TAG }, async ({ page, factory }) => {
  const patient = await factory.createPatient({ phone: null })
  const name = patient.name as string
  const guards = attachErrorGuards(page, {
    // The credit-only PDF request is refused on purpose (422 NO_PENDING_PAYMENT).
    expectedHttpErrors: [{ pathname: pdfPath(patient.id), status: 422 }],
  })

  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()
  // Method left at its default (UPI); notes left blank.
  await form.fillPaymentOnly({ patientName: name, amount: '650' }, { waitForPreview: true })
  await expect(form.dialog.getByTestId('allocation-preview')).toContainText('No sessions are awaiting regular payment')
  await expectNoLeakedNulls(page, { scope: form.dialog })
  await form.submit('payment')

  await expect.poll(async () => (await factory.findPayments({ patientId: patient.id })).length).toBe(1)
  const [payment] = await factory.findPayments({ patientId: patient.id })
  expect(payment).toMatchObject({ amount: 650, notes: null, payment_method: 'upi' })

  // The Payments row: no " · " left hanging where the notes would go.
  await page.goto('/billing?tab=payments')
  await openBillingTab(page, 'Payments')
  await revealAllRows(page)
  const cancel = paymentActionButton(page, 'Cancel', name, 650)
  await expect(cancel).toBeVisible()
  const row = page.locator('div').filter({ has: cancel }).filter({ hasText: name }).last()
  expect(danglingSeparators(await row.innerText())).toEqual([])
  await expectNoLeakedNulls(page)

  // No sessions, so the whole receipt is credit.
  const balanceRow = await findBalanceRow(page, patient.id)
  await expect(balanceRow).toContainText('Credit')
  await expect(balanceRow).toContainText('₹650')

  await page.goto(`/billing/payment-due/${patient.id}`)
  await page.getByRole('button', { name: 'Share payment PDF', exact: true }).click()
  const pdfDialog = page.getByRole('dialog', { name: 'Generate payment PDF' })
  const generate = pdfDialog.getByRole('button', { name: /^(Generate PDF|Generating…)$/ })
  await generate.click()
  await expect(pdfDialog.getByRole('alert')).toContainText('No payment pending')
  await expect(generate).toHaveAccessibleName('Generate PDF')
  await expect(generate).toBeEnabled()
  await expectNoLeakedNulls(page, { scope: pdfDialog })
  await page.keyboard.press('Escape')

  await openPatientBillingTab(page, patient.id)
  await expect(page.getByText('₹650', { exact: false }).filter({ visible: true }).first()).toBeVisible()
  await expectNoLeakedNulls(page)

  await visitEveryBillingScreen(page, { patientId: patient.id })
  await guards.assertClean()
})

// B-2. A package typed in by hand (no template), default method, no notes.
test('a package entered by hand without a template or notes renders on every billing screen', { tag: IOS_TAG }, async ({ page, factory }) => {
  const patient = await factory.createPatient({ phone: null })
  const guards = attachErrorGuards(page, {
    // Before any session is taken the package has nothing to report (422 NO_PENDING_PAYMENT).
    expectedHttpErrors: [{ pathname: pdfPath(patient.id), status: 422 }],
  })
  const packageName = factory.uniqueName('manual-package')
  factory.watchUiPackage({ patientId: patient.id, name: packageName })

  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()
  await form.fillPackageManual({ patientName: patient.name as string, packageName, sessions: '3', rate: '700' })
  await expect(form.amountInput).toHaveValue('2100')
  await expectNoLeakedNulls(page, { scope: form.dialog })
  await form.submit('package')

  await expect.poll(() => factory.findPackage({ patientId: patient.id, name: packageName })).not.toBeNull()
  const pkg = await factory.findPackage({ patientId: patient.id, name: packageName })
  expect(pkg).toMatchObject({ total_sessions: 3, per_session_amount: 700, total_amount: 2100, status: 'active' })
  const { data: receipt, error } = await adminClient().from('payments').select('amount, notes, payment_method').eq('package_id', pkg!.id).single()
  expect(error).toBeNull()
  expect(receipt).toEqual({ amount: 2100, notes: null, payment_method: 'upi' })

  // The package has no sessions yet: an empty history, not a crash.
  await page.goto(`/billing/packages/${pkg!.id}`)
  await expect(page.getByRole('heading', { name: 'Session history · 0' })).toBeVisible()
  await expect(page.getByText('No package session history yet.', { exact: true })).toBeVisible()
  await expectNoLeakedNulls(page)

  // A package with no session taken has nothing to report yet (payment-due-statement.ts).
  await page.goto(`/billing/payment-due/${patient.id}`)
  await page.getByRole('button', { name: 'Share payment PDF', exact: true }).click()
  const pdfDialog = page.getByRole('dialog', { name: 'Generate payment PDF' })
  const generate = pdfDialog.getByRole('button', { name: /^(Generate PDF|Generating…)$/ })
  await generate.click()
  await expect(pdfDialog.getByRole('alert')).toContainText('No payment pending')
  await expect(generate).toHaveAccessibleName('Generate PDF')
  await expectNoLeakedNulls(page, { scope: pdfDialog })
  await page.keyboard.press('Escape')

  await visitEveryBillingScreen(page, { patientId: patient.id, packageId: pkg!.id })

  // Once a session is taken under it, the package alone makes a PDF: no regular sessions at all.
  await factory.createAppointment({
    patientId: patient.id, date: clinicDate(), time: '07:15', fee: 700, status: 'completed', payment_status: 'unpaid',
  })
  await page.goto(`/billing/payment-due/${patient.id}`)
  await page.getByRole('button', { name: 'Share payment PDF', exact: true }).click()
  const download = page.waitForEvent('download')
  await pdfDialog.getByRole('button', { name: 'Generate PDF', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/^payment-summary-.*-all-regular\.pdf$/)
  await expect(pdfDialog).toContainText('PDF downloaded and ready to share.')
  await page.goto(`/billing/packages/${pkg!.id}`)
  await expect(page.getByRole('heading', { name: 'Session history · 1' })).toBeVisible()
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

// B-3. Package shapes the form never produces today: the pre-ledger (billing_version 1) package
// with no type or start date, a package with no payment and no session (an all-zero ledger), and
// a package cancelled through the UI with only the required reason.
test('legacy, ledger-less and cancelled packages render without leaks', { tag: IOS_TAG }, async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient({ phone: null })
  const name = patient.name as string
  const legacy = await factory.createPackage({
    patientId: patient.id, name: factory.uniqueName('legacy-package'),
    billing_version: 1, appointment_type_id: null, starts_on: null, paid_amount: 0,
  })
  const idle = await factory.createPackage({ patientId: patient.id, name: factory.uniqueName('idle-package'), paid_amount: 0 })
  const toCancel = await factory.createPackage({
    patientId: patient.id, name: factory.uniqueName('cancelled-package'), total_amount: 3200, per_session_amount: 800, paid_amount: 3200,
  })
  await factory.createPayment({ patientId: patient.id, package_id: toCancel.id, amount: 3200 })

  await page.goto('/billing?tab=packages')
  const form = new BillingEntryForm(page)
  await form.cancelPackage(name, toCancel.name as string)
  await expect.poll(async () => (await adminClient().from('packages').select('status').eq('id', toCancel.id).single()).data?.status).toBe('cancelled')

  await page.reload()
  await openBillingTab(page, 'Packages')
  await revealAllRows(page)
  for (const pkg of [legacy, idle, toCancel]) {
    await expect(page.getByText(pkg.name as string, { exact: true }).filter({ visible: true })).toBeVisible()
  }
  await expect(page.getByRole('link', { name: new RegExp(toCancel.name as string) })).toContainText('cancelled')
  await expectNoLeakedNulls(page)

  for (const packageId of [legacy.id, idle.id, toCancel.id, SEED.packageSparse]) {
    await page.goto(`/billing/packages/${packageId}`)
    await expect(page.getByRole('heading', { name: /^Session history · \d+$/ })).toBeVisible()
    await expectNoLeakedNulls(page)
  }

  for (const patientId of [patient.id, SEED.patientSparse]) {
    await openPatientBillingTab(page, patientId)
    await expect(page.getByRole('heading', { name: 'Packages', exact: true }).filter({ visible: true })).toBeVisible()
    await expectNoLeakedNulls(page)
    await page.goto(`/billing/payment-due/${patientId}`)
    await expect(page.getByRole('button', { name: 'Share payment PDF', exact: true })).toBeVisible()
    await expectNoLeakedNulls(page)
  }
  await guards.assertClean()
})

test('temporary staff added without an email renders in settings', { tag: IOS_TAG }, async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('no-email-temp-staff')
  const phone = factory.uniqueMobile()
  factory.watchUiExternalStaff({ name, phone })

  await page.goto('/settings')
  const settings = new SettingsView(page)
  await settings.addExternalStaff({ name, phone })
  expect(await factory.findExternalStaff({ name, phone })).toMatchObject({ email: null, status: 'active' })

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await settings.openSection('Temporary Staff')
  await expect(page.getByText(name, { exact: true }).filter({ visible: true })).toBeVisible()
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

// "Appointment Type *" is a Radix Select. Left untouched, its hidden native <select> must not
// quietly submit the first type: the package would then only cover that type's sessions.
test('a package cannot be saved until an appointment type is chosen', { tag: IOS_TAG }, async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient({ phone: null })
  const name = factory.uniqueName('typeless-package')
  factory.watchUiPackage({ patientId: patient.id, name })

  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()
  await page.getByRole('button', { name: /Package \+ payment/i }).click()
  await form.selectPatientByName(patient.name as string)
  await page.getByLabel('Package Name *', { exact: true }).fill(name)
  await page.getByLabel('Sessions *', { exact: true }).fill('4')
  await page.getByLabel('Per Session *', { exact: true }).fill('500')
  const actionRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.headers()['next-action'] !== undefined) actionRequests.push(request.url())
  })
  await page.getByRole('button', { name: 'Save Package', exact: true }).click()

  // The browser's required-field check stops the submit: the type's native select is the field
  // left invalid, the dialog stays open, and no save request leaves the page.
  const dialog = page.getByRole('dialog', { name: 'New Billing Entry' })
  await expect(dialog).toBeVisible()
  const typeSelect = dialog.locator('select[name="appointment_type_id"]')
  await expect.poll(() => typeSelect.evaluate((select: HTMLSelectElement) => select.validity.valueMissing)).toBe(true)
  expect(await dialog.locator('form').evaluate((form: HTMLFormElement) => form.checkValidity())).toBe(false)
  expect(actionRequests).toEqual([])
  const { data, error } = await adminClient().from('packages').select('id, appointment_type_id').eq('patient_id', patient.id)
  expect(error).toBeNull()
  expect(data).toEqual([])
  await guards.assertClean()
})
