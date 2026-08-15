// Admin-only Billing coverage. The first test remains the direct real-timestamptz regression guard
// that motivated the E2E suite; the remaining cases exercise the critical write paths.

import { format, parseISO } from 'date-fns'
import { BillingEntryForm } from '../pages/billing-entry-form'
import { attachErrorGuards } from '../support/assertions'
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
  await expect(page.getByText('Regular allocation', { exact: true })).toBeVisible()
  await expect(page.getByText(/including partial sessions/i)).toBeVisible()
  await form.submit('payment')

  // BillingView owns a local timeline array; a fresh document load consumes the revalidated data.
  await page.reload()
  await page.getByRole('button', { name: 'Payments', exact: true }).click()
  await expect(page.getByRole('button', {
    name: `Void payment for ${patient.name as string} · ₹1,000`,
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

test('creates a prepaid package with payment from the seeded template prefill', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const templateName = 'E2E Standard 6 Sessions'
  const packageName = factory.uniqueName('template-package')
  const notes = factory.uniqueName('ui-package-payment')
  factory.watchUiPackage({ patientId: patient.id, name: packageName })
  factory.watchUiPayment({ patientId: patient.id, notes })

  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()
  await form.fillPackageFromTemplate({
    patientName: patient.name as string,
    amount: '4500',
    method: 'Card',
    notes,
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
  const payment = await factory.findPayment({ patientId: patient.id, notes })
  expect(payment).toMatchObject({ package_id: pkg!.id, amount: 4500, payment_method: 'card' })
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
    name: `Void payment for ${patient.name as string} · ₹625`,
    exact: true,
  })
  await expect(voidButton).toBeVisible()
  await form.voidPayment(patient.name as string, 625)

  await expect(voidButton).toHaveCount(0)
  await expect.poll(async () => (await adminClient().from('payments').select('status, void_reason').eq('id', payment.id).single()).data).toMatchObject({ status: 'voided', void_reason: 'E2E correction' })
  await guards.assertClean()
})

test('cancels a created package without deleting its payment history', async ({ page, factory }) => {
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
  await expect.poll(async () => (await db.from('payments').select('id').eq('id', payment.id).maybeSingle()).data?.id).toBe(payment.id)
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
  await expect(page.getByText(patient.name as string, { exact: true })).toBeVisible()
  await expect(page.getByText('₹1,375', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: /^(Back to billing|Go back)$/ }).click()
  await page.getByRole('link', { name: /Received/ }).click()
  await expect(page).toHaveURL('/billing/metrics/received-this-month')
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

// The v2 balance view sums appointment charges in both 'pending' (scheduled) and 'posted'
// (completed) states, so the drill-down has to list scheduled sessions too — otherwise the
// ₹1,600 Regular due tile is unexplainable from the ₹800 of completed sessions below it.
test('Balance detail lists scheduled sessions so the per-section subtotals reconcile with the due tile', async ({ page }) => {
  const guards = attachErrorGuards(page)
  await page.goto(`/billing/payment-due/${SEED.patientPaymentDue}`)

  await expect(page.getByRole('heading', { name: 'Unpaid sessions' })).toBeVisible()
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
