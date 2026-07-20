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
  await expect(page.getByText('Linked value:', { exact: false })).toBeVisible()
  await expect(page.getByText('Advance credit:', { exact: false })).toBeVisible()
  await form.submit('payment')

  // BillingView owns a local timeline array; a fresh document load consumes the revalidated data.
  await page.reload()
  await page.getByRole('button', { name: 'Payments', exact: true }).click()
  await expect(page.getByText(patient.name as string, { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByRole('button', {
    name: `Delete payment for ${patient.name as string} · ₹1,000`,
    exact: true,
  })).toBeVisible()

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
    .from('appointment_payments')
    .select('appointment_id, amount_applied')
    .eq('payment_id', payment!.id)
  expect(error).toBeNull()
  expect(allocations).toEqual([{ appointment_id: appointment.id, amount_applied: 800 }])
  expect(1000 - Number(allocations![0].amount_applied)).toBe(200)
  const appointments = await factory.findAppointments({ patientId: patient.id, notes: appointment.notes as string })
  expect(appointments[0].payment_status).toBe('paid')
  await guards.assertClean()
})

test('creates a prepaid package with payment from the seeded template prefill', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const packageName = 'E2E Standard 6 Sessions'
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
    templateName: packageName,
  })
  await form.expectPackagePrefill({ name: packageName, sessions: '6', rate: '750', amount: '4500' })
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

test('deletes a created payment through the confirmation UI', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const payment = await factory.createPayment({ patientId: patient.id, amount: 625, notes: factory.uniqueName('delete-payment') })

  await page.goto('/billing?tab=payments')
  const form = new BillingEntryForm(page)
  const deletePayment = page.getByRole('button', {
    name: `Delete payment for ${patient.name as string} · ₹625`,
    exact: true,
  })
  await expect(deletePayment).toBeVisible()
  await form.deletePayment(patient.name as string, 625)

  await expect(deletePayment).toHaveCount(0)
  await expect.poll(async () => (await adminClient().from('payments').select('id').eq('id', payment.id).maybeSingle()).data).toBeNull()
  await guards.assertClean()
})

test('deletes a created package and its payment through the confirmation UI', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const packageName = factory.uniqueName('delete-package')
  const pkg = await factory.createPackage({ patientId: patient.id, name: packageName, total_amount: 3200, paid_amount: 3200 })
  const payment = await factory.createPayment({ patientId: patient.id, package_id: pkg.id, amount: 3200 })

  await page.goto('/billing?tab=packages')
  const form = new BillingEntryForm(page)
  await expect(page.getByText(packageName, { exact: true })).toBeVisible()
  await form.deletePackage(patient.name as string, packageName)

  await expect(page.getByText(packageName, { exact: true })).toHaveCount(0)
  const db = adminClient()
  await expect.poll(async () => (await db.from('packages').select('id').eq('id', pkg.id).maybeSingle()).data).toBeNull()
  await expect.poll(async () => (await db.from('payments').select('id').eq('id', payment.id).maybeSingle()).data).toBeNull()
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
  await expect(page.getByText('bank_transfer', { exact: true })).toBeVisible()
  await expect(page.getByText('₹2,468', { exact: true })).toBeVisible()

  await page.goto('/billing')
  await page.getByRole('button', { name: 'Outstanding', exact: false }).click()
  await page.getByRole('link', { name: /Meera Payment Due/ }).click()
  await expect(page).toHaveURL(`/billing/payment-due/${SEED.patientPaymentDue}`)
  await expect(page.getByText('Meera Payment Due', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText(format(parseISO(clinicDate(-1)), 'dd MMM yyyy'), { exact: true })).toBeVisible()
  await expect(page.getByText('Clinic', { exact: true })).toBeVisible()
  await expect(page.getByRole('main')).toContainText('₹800')
  await guards.assertClean()
})
