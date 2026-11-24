// Admin-only Billing coverage. The first test remains the direct real-timestamptz regression guard
// that motivated the E2E suite; the remaining cases exercise the critical write paths.

import { format, parseISO } from 'date-fns'
import {
  BillingEntryForm,
  openBillingTab,
  paymentActionButton,
  refundHistoryRow,
  revealAllRows,
} from '../pages/billing-entry-form'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { expandAllDateGroups, expandDateGroup } from '../support/date-groups'
import { expectedFaultConsoleErrors } from '../support/fault-injection'
import { isMobileProject } from '../support/mobile'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'
import { SEED } from '../support/ids'
import { adminClient } from '../support/supabase-admin'

test('Billing → Packages tab renders a package with a timestamp created_at (regression)', async ({ page }) => {
  const guards = attachErrorGuards(page)
  const response = await page.goto('/billing?tab=packages', { waitUntil: 'domcontentloaded' })
  expect(response?.ok(), `GET /billing?tab=packages returned ${response?.status()}`).toBe(true)
  expect(response?.request().redirectedFrom()).toBeNull()
  await expect(page).toHaveURL(/\/billing\?tab=packages$/)
  await expect(page.getByText('10-Session Physiotherapy Package')).toBeVisible()
  await expect(page.getByText('Asha Rao')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await guards.assertClean()
})

test('records a payment, allocates the unpaid session, and shows the timeline entry', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({
    patientId: patient.id,
    date: clinicDate(-3),
    time: '09:40',
    fee: 800,
    status: 'completed',
    payment_status: 'unpaid',
  })
  const notes = factory.uniqueName('ui-payment')
  factory.watchUiPayment({ patientId: patient.id, notes })

  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()
  await form.fillPaymentOnly({
    patientName: patient.name as string,
    amount: '1000',
    method: 'UPI',
    notes,
  })
  // The preview must name the actual session the receipt lands on, not just describe the rule:
  // ₹1,000 against one ₹800 session settles it in full and leaves ₹200 as credit.
  const preview = page.getByTestId('allocation-preview')
  await expect(preview.getByText('What this payment settles', { exact: true })).toBeVisible()
  await expect(preview.getByText(format(parseISO(appointment.date as string), 'dd MMM yyyy'))).toBeVisible()
  await expect(preview.getByText(/across 1 session, oldest first/)).toBeVisible()
  await expect(preview.getByText(/₹200 left as credit/)).toBeVisible()
  await form.submit('payment')

  // BillingView owns a local timeline array; a fresh document load consumes the revalidated data.
  await page.reload()
  await page.getByRole('button', { name: 'Payments', exact: true }).click()
  await expect(page.getByRole('button', {
    name: `Cancel payment for ${patient.name as string} · ₹1,000`,
    exact: true,
  })).toBeVisible({ timeout: 10_000 })

  const payment = await expect.poll(() => factory.findPayment({
    patientId: patient.id,
    notes,
  })).not.toBeNull().then(() => factory.findPayment({ patientId: patient.id, notes }))
  expect(payment).toMatchObject({
    amount: 1000,
    payment_method: 'upi',
    date: clinicDate(),
    package_id: null,
  })
  const db = adminClient()
  const { data: allocations, error } = await db
    .from('payment_applications')
    .select('charge:appointment_charges(appointment_id), amount')
    .eq('payment_id', payment!.id)
    .eq('status', 'active')
  expect(error).toBeNull()
  expect(allocations?.[0]).toMatchObject({ charge: { appointment_id: appointment.id }, amount: 800 })
  expect(1000 - Number(allocations![0].amount)).toBe(200)
  const appointments = await factory.findAppointments({ patientId: patient.id, notes: appointment.notes as string })
  expect(appointments[0].payment_status).toBe('paid')
  await guards.assertClean()
})

// Notes are optional for a package receipt, so this flow deliberately leaves them blank.
test('creates a prepaid package with payment from the seeded template prefill, without notes', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const templateName = 'E2E Standard 6 Sessions'
  const packageName = factory.uniqueName('template-package')
  factory.watchUiPackage({ patientId: patient.id, name: packageName })

  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()
  await form.fillPackageFromTemplate({
    patientName: patient.name as string,
    amount: '4500',
    method: 'Card',
    templateName,
  })
  await form.expectPackagePrefill({ name: templateName, sessions: '6', rate: '750', amount: '4500' })
  await page.getByLabel('Package Name *', { exact: true }).fill(packageName)
  await form.submit('package')

  await page.reload()
  await page.getByRole('button', { name: 'Packages', exact: true }).click()
  await expect(page.getByText(packageName, { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText(patient.name as string, { exact: true }).filter({ visible: true })).toBeVisible()

  await expect.poll(() => factory.findPackage({ patientId: patient.id, name: packageName })).not.toBeNull()
  const pkg = await factory.findPackage({ patientId: patient.id, name: packageName })
  expect(pkg).toMatchObject({
    total_sessions: 6,
    used_sessions: 0,
    total_amount: 4500,
    per_session_amount: 750,
    paid_amount: 4500,
    payment_timing: 'prepaid',
    status: 'active',
  })
  const { data: payment } = await adminClient().from('payments').select('*').eq('package_id', pkg!.id).single()
  expect(payment).toMatchObject({ package_id: pkg!.id, amount: 4500, payment_method: 'card', notes: null })
  await guards.assertClean()
})

// Standalone receipts are regular-scoped by construction — the form has no scope picker, so an
// open package on the same patient must not capture the money.
test('keeps a standalone receipt regular-scoped even when the patient holds a package', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  await factory.createPackage({ patientId: patient.id, name: factory.uniqueName('partial-package'), total_amount: 4000, paid_amount: 0 })
  const notes = factory.uniqueName('regular-receipt')
  factory.watchUiPayment({ patientId: patient.id, notes })

  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()
  await form.fillPaymentOnly({ patientName: patient.name as string, amount: '500', method: 'UPI', notes })
  await expect(page.getByLabel('Funding Scope *', { exact: true })).toHaveCount(0)
  await form.submit('payment')

  await expect.poll(() => factory.findPayment({ patientId: patient.id, notes })).not.toBeNull()
  const payment = await factory.findPayment({ patientId: patient.id, notes })
  expect(payment).toMatchObject({ funding_scope: 'ordinary', package_id: null, amount: 500 })
  await guards.assertClean()
})

test('voids a created payment through the audited correction UI', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const payment = await factory.createPayment({ patientId: patient.id, amount: 625, notes: factory.uniqueName('delete-payment') })

  await page.goto('/billing?tab=payments')
  const form = new BillingEntryForm(page)
  const voidButton = page.getByRole('button', {
    name: `Cancel payment for ${patient.name as string} · ₹625`,
    exact: true,
  })
  await expect(voidButton).toBeVisible()
  await form.voidPayment(patient.name as string, 625)

  await expect(voidButton).toHaveCount(0)
  await expect.poll(async () => (await adminClient().from('payments').select('status, void_reason').eq('id', payment.id).single()).data).toMatchObject({ status: 'voided', void_reason: 'E2E correction' })
  await guards.assertClean()
})

test('cancelling a package cancels its payment too, keeping both rows for the audit trail', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const packageName = factory.uniqueName('delete-package')
  const pkg = await factory.createPackage({ patientId: patient.id, name: packageName, total_amount: 3200, paid_amount: 3200 })
  const payment = await factory.createPayment({ patientId: patient.id, package_id: pkg.id, amount: 3200 })

  await page.goto('/billing?tab=packages')
  const form = new BillingEntryForm(page)
  await expect(page.getByText(packageName, { exact: true })).toBeVisible()
  await form.cancelPackage(patient.name as string, packageName)

  const db = adminClient()
  await expect.poll(async () => (await db.from('packages').select('status, cancellation_reason').eq('id', pkg.id).single()).data).toMatchObject({ status: 'cancelled', cancellation_reason: 'E2E package correction' })
  await expect.poll(async () => (await db.from('payments').select('status, void_reason').eq('id', payment.id).maybeSingle()).data).toMatchObject({ status: 'voided', void_reason: 'E2E package correction' })
  await guards.assertClean()
})

test('metric drill-downs list their real records and payment due lists the seeded unpaid session', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  await factory.createAppointment({
    patientId: patient.id,
    date: clinicDate(),
    time: '12:35',
    fee: 1375,
    status: 'completed',
    payment_status: 'unpaid',
  })
  await factory.createPayment({ patientId: patient.id, amount: 2468, date: clinicDate(), payment_method: 'bank_transfer' })

  await page.goto('/billing')
  await page.getByRole('link', { name: /Total billed/ }).click()
  await expect(page).toHaveURL('/billing/metrics/billed-this-month')
  // Records sit behind a collapsed accordion per date.
  await expandAllDateGroups(page)
  await expect(page.getByText(patient.name as string, { exact: true })).toBeVisible()
  // The date header shows the day's total, which for a single-session day is this same figure.
  await expect(page.getByText('₹1,375', { exact: true }).first()).toBeVisible()

  await page.getByRole('link', { name: /^(Back to billing|Go back)$/ }).click()
  await page.getByRole('link', { name: /Received/ }).click()
  await expect(page).toHaveURL('/billing/metrics/received-this-month')
  await expandAllDateGroups(page)
  await expect(page.getByText(patient.name as string, { exact: true })).toBeVisible()
  await expect(page.getByText('bank_transfer', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('₹2,468', { exact: true }).first()).toBeVisible()

  await page.goto('/billing')
  await page.getByRole('button', { name: 'Outstanding', exact: false }).click()
  await page.getByRole('link', { name: /Meera Payment Due/ }).click()
  await expect(page).toHaveURL(`/billing/payment-due/${SEED.patientPaymentDue}`)
  await expect(page.getByText('Meera Payment Due', { exact: true }).filter({ visible: true })).toBeVisible()
  // Scoped to the completed-sessions card: the scheduled card below it renders its own 'Clinic'
  // badge, so a page-wide exact-text match is ambiguous under Playwright strict mode.
  const unpaidCard = page.getByTestId('unpaid-sessions-card')
  await expect(unpaidCard.getByText(format(parseISO(clinicDate(-1)), 'dd MMM yyyy'), { exact: true })).toBeVisible()
  await expect(unpaidCard.getByText('Clinic', { exact: true })).toBeVisible()
  await expect(unpaidCard).toContainText('₹800')
  await guards.assertClean()
})

test('generates a regular payment PDF from completed sessions and keeps it ready to share', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  await factory.createAppointment({
    patientId: patient.id,
    date: clinicDate(-2),
    time: '10:20',
    fee: 800,
    status: 'completed',
    payment_status: 'unpaid',
  })

  await page.goto(`/billing/payment-due/${patient.id}`)
  await page.getByRole('button', { name: 'Share payment PDF', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Generate PDF', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^payment-summary-.*\.pdf$/)
  await expect(dialog.getByRole('button', { name: 'Share PDF', exact: true })).toBeVisible()
  await expect(dialog).toContainText('PDF downloaded and ready to share.')
  await guards.assertClean()
})

// The v2 balance view sums appointment charges in both 'pending' (scheduled) and 'posted'
// (completed) states, so the drill-down has to list scheduled sessions too — otherwise the
// ₹1,600 Regular due tile is unexplainable from the ₹800 of completed sessions below it.
test('Balance detail lists scheduled sessions so the per-section subtotals reconcile with the due tile', async ({ page }) => {
  const guards = attachErrorGuards(page)
  await page.goto(`/billing/payment-due/${SEED.patientPaymentDue}`)

  await expect(page.getByRole('heading', { name: 'Sessions due' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Scheduled sessions' })).toBeVisible()

  // Seeded: one completed ₹800 session (yesterday) plus one scheduled ₹800 session, tallying
  // to the ₹1,600 regular due.
  const completedCard = page.getByTestId('unpaid-sessions-card')
  await expect(completedCard).toContainText(format(parseISO(clinicDate(-1)), 'dd MMM yyyy'))
  await expect(completedCard).toContainText('Session fees shown')
  await expect(completedCard).toContainText('₹800')

  const scheduledCard = page.getByTestId('scheduled-sessions-card')
  await expect(scheduledCard).toContainText('Scheduled fees shown')
  await expect(scheduledCard).toContainText('₹800')
  await expect(scheduledCard).not.toContainText('No scheduled sessions')

  await expect(page.getByText('₹1,600', { exact: true }).first()).toBeVisible()
  await guards.assertClean()
})

// The "Package due" and "Package credit" tiles on the balance detail are unexplainable on their own.
// The drill-down now carries the packages behind them, each with its progress bar, and each still a
// link onward to the same package detail the billing overview opens.
test('Balance detail shows package progress and drills through to the package detail', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const pkg = await factory.createPackage({
    patientId: patient.id,
    name: factory.uniqueName('balance-detail-package'),
    total_sessions: 4,
    total_amount: 3200,
    per_session_amount: 800,
    paid_amount: 3200,
    payment_timing: 'prepaid',
  })
  // One fee-matched completed session is auto-allocated to the prepaid package by the billing trigger.
  await factory.createAppointment({
    patientId: patient.id,
    date: clinicDate(-2),
    time: '08:05',
    fee: 800,
    status: 'completed',
    payment_status: 'unpaid',
  })

  await page.goto(`/billing/payment-due/${patient.id}`)

  await expect(page.getByRole('heading', { name: 'Packages' })).toBeVisible()
  const card = page.getByTestId(`package-progress-${pkg.id}`)
  await expect(card).toBeVisible()
  await expect(card).toContainText(pkg.name as string)
  await expect(card).toContainText('4 total')
  await expect(card.getByLabel(`${pkg.name} session progress`)).toBeVisible()

  await card.click()
  await expect(page).toHaveURL(`/billing/packages/${pkg.id}`)
  await expect(page.getByRole('heading', { name: /Session history/ })).toBeVisible()
  await guards.assertClean()
})

test('Balance detail omits the packages section for a patient with no packages', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  await factory.createAppointment({
    patientId: patient.id,
    date: clinicDate(-2),
    time: '08:15',
    fee: 800,
    status: 'completed',
    payment_status: 'unpaid',
  })

  await page.goto(`/billing/payment-due/${patient.id}`)

  await expect(page.getByRole('heading', { name: 'Sessions due' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Packages' })).toHaveCount(0)
  await expect(page.getByTestId('package-progress-list')).toHaveCount(0)
  await guards.assertClean()
})

// A prepaid package owes nothing, so the collection-only statement used to come back empty and the
// admin could never produce the package's session record. Package history is reportable on its own.
test('generates a payment PDF for a patient whose only billing is a fully prepaid package', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  await factory.createPackage({
    patientId: patient.id,
    name: factory.uniqueName('prepaid-only-package'),
    total_sessions: 4,
    total_amount: 3200,
    per_session_amount: 800,
    paid_amount: 3200,
    payment_timing: 'prepaid',
  })
  await factory.createAppointment({
    patientId: patient.id,
    date: clinicDate(-2),
    time: '08:25',
    fee: 800,
    status: 'completed',
    payment_status: 'unpaid',
  })

  await page.goto(`/billing/payment-due/${patient.id}`)
  await page.getByRole('button', { name: 'Share payment PDF', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Generate PDF', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^payment-summary-.*\.pdf$/)
  await expect(dialog).not.toContainText('No payment pending')
  await expect(dialog).toContainText('PDF downloaded and ready to share.')
  await guards.assertClean()
})

// Reconciliation releases the 'scheduled' allocation and inserts an 'availed' one when a session is
// completed, so the ledger holds two rows for one session. Session history reads per session.
test('Package session history shows one row per session after a scheduled session is completed', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const pkg = await factory.createPackage({
    patientId: patient.id,
    name: factory.uniqueName('reconciled-package'),
    total_sessions: 4,
    total_amount: 3200,
    per_session_amount: 800,
    paid_amount: 3200,
    payment_timing: 'prepaid',
  })
  const appointment = await factory.createAppointment({
    patientId: patient.id,
    date: clinicDate(-2),
    time: '08:35',
    fee: 800,
    status: 'scheduled',
    payment_status: 'unpaid',
  })
  await factory.updateAppointment(appointment.id as string, { status: 'completed' })

  await page.goto(`/billing/packages/${pkg.id}`)

  await expect(page.getByRole('heading', { name: 'Session history · 1' })).toBeVisible()
  await expect(page.getByText('Availed', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Released', { exact: true })).toHaveCount(0)
  await expect(page.getByText('reconciled: appointment or package eligibility changed')).toHaveCount(0)
  await guards.assertClean()
})

/** A date as the received drill-down's accordion headers render it, e.g. "18 Sep". */
function dayLabel(date = clinicDate()): string {
  return format(parseISO(date), 'dd MMM')
}

// B-5. A partial refund and its reversal through the audited dialog. The Refund and Cancel buttons
// are separate desktop and mobile twins on each payment row; getByRole picks the one this viewport
// shows, and exactly one of each is visible.
test('refunds part of a payment, shows it in the ledger and the received metric, then reverses it', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient({ phone: null })
  const name = patient.name as string
  const payment = await factory.createPayment({ patientId: patient.id, amount: 1000, date: clinicDate() })
  const refundReason = factory.uniqueName('refund-reason')

  await page.goto('/billing?tab=payments')
  await openBillingTab(page, 'Payments')
  await revealAllRows(page)
  const refund = paymentActionButton(page, 'Refund', name, 1000)
  const cancel = paymentActionButton(page, 'Cancel', name, 1000)
  await expect(refund).toHaveCount(1)
  await expect(cancel).toHaveCount(1)

  // Method and date keep their defaults (UPI, today).
  const form = new BillingEntryForm(page)
  await form.refundPayment(name, 1000, { refundAmount: 400, reason: refundReason })

  const row = page.locator('div').filter({ has: refund }).filter({ hasText: name }).last()
  await expect(row).toContainText('Partially refunded')
  await expect(cancel).toHaveCount(0)
  await expect(refund).toHaveCount(1)
  const history = refundHistoryRow(page, refundReason)
  await expect(history).toContainText('₹400')
  await expect(history).toContainText('Refunded')
  await expectNoLeakedNulls(page)

  await expect.poll(() => factory.findRefunds({ paymentId: payment.id })).toHaveLength(1)
  const [refundRow] = await factory.findRefunds({ paymentId: payment.id })
  expect(refundRow).toMatchObject({ amount: 400, reason: refundReason, refund_method: 'upi', refund_date: clinicDate() })

  // The received drill-down nets the refund out as its own negative row.
  await page.goto('/billing/metrics/received-this-month')
  await expandDateGroup(page.getByTestId('date-group-header').filter({ hasText: dayLabel() }).first())
  const refundLine = page.getByTestId('date-group-list').locator('div')
    .filter({ hasText: name }).filter({ hasText: /refund/i }).filter({ hasText: '₹' }).last()
  await expect(refundLine).toContainText('-400')
  await expectNoLeakedNulls(page)

  await page.goto('/billing?tab=payments')
  await form.reverseRefund(refundReason, 400, factory.uniqueName('reverse-reason'))
  await expect(refundHistoryRow(page, refundReason)).toContainText('Reversed')
  await expect(cancel).toHaveCount(1)
  await expect(page.locator('div').filter({ has: cancel }).filter({ hasText: name }).last()).toContainText('Received')
  const { data: reversals, error } = await adminClient().from('refund_reversals').select('refund_id').eq('refund_id', refundRow.id)
  expect(error).toBeNull()
  expect(reversals).toHaveLength(1)
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

// B-14. The `?new=1` deep link (the phone dashboard's "New billing" quick action) opens the entry
// dialog; closing it puts the URL back to the tab without `new`.
test('/billing?new=1 opens the entry dialog, closing it cleans the URL, and the phone dashboard links to it', async ({ page }, testInfo) => {
  const guards = attachErrorGuards(page)
  await page.goto('/billing?new=1&tab=payments')
  const dialog = page.getByRole('dialog', { name: 'New Billing Entry' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/billing\?tab=payments$/)
  // The modal hid the page from the accessibility tree; now the requested tab is the open one.
  await expect(page.getByRole('heading', { name: /^Payments · \d+$/ })).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  const quickAction = page.getByRole('link', { name: 'New billing', exact: true })
  if (!isMobileProject(testInfo)) {
    // The quick-action grid is phone-only; desktop opens the dialog from /billing itself.
    await expect(quickAction.filter({ visible: true })).toHaveCount(0)
    await guards.assertClean()
    return
  }
  await quickAction.click()
  await expect(page).toHaveURL(/\/billing\?new=1$/)
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/billing$/)
  await guards.assertClean()
})

/** The previous clinic month as `YYYY-MM`. */
function previousMonth(): string {
  const [year, month] = clinicDate().split('-').map(Number)
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7)
}

// B-15. "Previous month only" PDF names its month; a dropped or failed PDF request leaves the
// dialog usable with a message and a working retry.
test('a previous-month payment PDF carries the month in its filename', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient({ phone: null })
  await factory.createAppointment({
    patientId: patient.id, date: `${previousMonth()}-15`, time: '10:05', fee: 800, status: 'completed', payment_status: 'unpaid',
  })

  await page.goto(`/billing/payment-due/${patient.id}`)
  await page.getByRole('button', { name: 'Share payment PDF', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Generate payment PDF' })
  await dialog.getByRole('radio', { name: /Previous month only/ }).check()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Generate PDF', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(new RegExp(`^payment-summary-.*-regular-${previousMonth()}\\.pdf$`))
  await expect(dialog).toContainText('PDF downloaded and ready to share.')
  await guards.assertClean()
})

test.describe('payment PDF failures', () => {
  test.use({ serviceWorkers: 'block' })

  test('payment PDF generation recovers from a dropped connection and from a server error', async ({ page, factory }) => {
    const patient = await factory.createPatient({ phone: null })
    const pdfUrl = `/api/billing/payment-due/${patient.id}/pdf`
    const guards = attachErrorGuards(page, { expectedFailures: expectedFaultConsoleErrors('server-action') })
    await factory.createAppointment({
      patientId: patient.id, date: clinicDate(-2), time: '10:15', fee: 800, status: 'completed', payment_status: 'unpaid',
    })

    await page.goto(`/billing/payment-due/${patient.id}`)
    await page.getByRole('button', { name: 'Share payment PDF', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Generate payment PDF' })
    const generate = dialog.getByRole('button', { name: /^(Generate PDF|Generating…)$/ })

    let aborted = 0
    await page.route((url) => url.pathname === pdfUrl, async (route) => {
      aborted += 1
      await route.abort('failed')
    })
    await generate.click()
    await expect(dialog.getByRole('alert')).toHaveText('Could not generate the payment PDF. Check your connection and try again.')
    await expect(generate).toHaveAccessibleName('Generate PDF')
    await expect(generate).toBeEnabled()
    expect(aborted).toBe(1)
    await page.unrouteAll({ behavior: 'wait' })

    let failed = 0
    await page.route((url) => url.pathname === pdfUrl, async (route) => {
      failed += 1
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ errorCode: 'STATEMENT_UNAVAILABLE', message: 'E2E injected PDF failure' }),
      })
    })
    await generate.click()
    await expect(dialog.getByRole('alert')).toHaveText('E2E injected PDF failure')
    await expect(generate).toHaveAccessibleName('Generate PDF')
    await expect(generate).toBeEnabled()
    expect(failed).toBe(1)
    await page.unrouteAll({ behavior: 'wait' })

    const download = page.waitForEvent('download')
    await generate.click()
    expect((await download).suggestedFilename()).toMatch(/^payment-summary-.*\.pdf$/)
    await expect(dialog).toContainText('PDF downloaded and ready to share.')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await guards.assertClean()
  })
})
