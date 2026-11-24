// Billing lists past their first page (plan 5.3, B-12 and B-13). /billing server-renders the 50
// newest payments and packages; "View more" reveals them past the first ten and "Load more" reads
// the next 50 straight from Supabase in the browser. The Payments Balance tab pages 25 patients at
// a time on the client.
//
// Fixtures are dated far in the past (years back) so they sit at the end of the clinic's lists,
// straddle the 50-row server page, and never touch this month's metrics. Each row gets a distinct
// date and amount (payments) or creation time and name (packages). The reads order by that column
// and then by id (G-6), so ties no longer make the paging nondeterministic either.

import type { Locator, Page } from '@playwright/test'
import {
  auditSaveButton,
  openAuditDialog,
  openBillingTab,
  paymentActionButton,
} from '../pages/billing-entry-form'
import { CLINIC_A } from '../support/accounts'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect, type E2EFactory } from '../support/factories'
import {
  NETWORK_ERROR_MESSAGE,
  expectButtonRecovers,
  expectFailureMessage,
  expectedFaultConsoleErrors,
  failNextSupabaseCall,
} from '../support/fault-injection'
import { adminClient } from '../support/supabase-admin'

test.use({ serviceWorkers: 'block' })

const ROWS = 60

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 60 payments for one patient: amounts ₹1,001…₹1,060, one per day starting ~8 years back. */
async function seedPayments(factory: E2EFactory) {
  const patient = await factory.createPatient({ phone: null })
  const amounts = Array.from({ length: ROWS }, (_, index) => 1001 + index)
  const { error } = await adminClient().from('payments').insert(amounts.map((amount, index) => ({
    clinic_id: CLINIC_A.id,
    patient_id: patient.id,
    amount,
    payment_method: 'upi',
    date: clinicDate(-3000 - index),
    notes: factory.uniqueName('load-more-payment'),
    funding_scope: 'ordinary',
    status: 'posted',
    billing_version: 2,
  })))
  expect(error).toBeNull()
  return { patient, name: patient.name as string, amounts }
}

/** 60 packages for one patient, each created on its own day ~10 years back. */
async function seedPackages(factory: E2EFactory) {
  const patient = await factory.createPatient({ phone: null })
  const type = await factory.findAppointmentType(true)
  const names = Array.from({ length: ROWS }, () => factory.uniqueName('load-more-package'))
  const { error } = await adminClient().from('packages').insert(names.map((name, index) => ({
    clinic_id: CLINIC_A.id,
    patient_id: patient.id,
    name,
    total_sessions: 4,
    used_sessions: 0,
    total_amount: 3000,
    per_session_amount: 750,
    paid_amount: 0,
    payment_timing: 'prepaid',
    status: 'active',
    appointment_type_id: type.id,
    starts_on: clinicDate(-3650),
    billing_version: 2,
    created_at: new Date(Date.UTC(2016, 0, 1) - index * 86_400_000).toISOString(),
  })))
  expect(error).toBeNull()
  return { patient, names }
}

function viewMore(page: Page): Locator {
  return page.getByRole('button', { name: /^View more \(\d+ more\)$/ })
}

/** The Load more control in either label. */
function loadMore(page: Page): Locator {
  return page.getByRole('button', { name: /^(Load more \(\d+ remaining\)|Loading…)$/ })
}

/** Press Load more until the list is exhausted; each press must change the remaining count. */
async function loadEverything(page: Page): Promise<void> {
  for (let presses = 0; presses < 10; presses++) {
    const button = loadMore(page)
    if (!(await button.isVisible())) return
    const label = (await button.getAttribute('aria-label')) ?? (await button.innerText()).trim()
    await button.click()
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Loading…', exact: true })).toHaveCount(0)
  }
  throw new Error('Load more never ran out')
}

async function visibleLabels(locator: Locator): Promise<string[]> {
  return (await locator.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label') ?? element.textContent ?? ''))).sort()
}

const paymentLabel = (name: string, amount: number) => `Cancel payment for ${name} · ₹${amount.toLocaleString('en-IN')}`

function ourCancelButtons(page: Page, name: string): Locator {
  return page.getByRole('button', { name: new RegExp(`^Cancel payment for ${escapeRegExp(name)} · `) })
}

async function openPaymentsFirstPage(page: Page): Promise<void> {
  await page.goto('/billing?tab=payments')
  await openBillingTab(page, 'Payments')
  await viewMore(page).click()
  await expect(page.getByRole('button', { name: 'Show less', exact: true })).toBeVisible()
}

function guardsFor(page: Page, resource: 'rest/v1/payments' | 'rest/v1/refunds' | 'rest/v1/packages') {
  return attachErrorGuards(page, {
    expectedFailures: expectedFaultConsoleErrors(resource),
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }],
  })
}

test('Payments "Load more" pages past the first 50 with no duplicate or missing rows, and Show less folds the list', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const { name, amounts } = await seedPayments(factory)

  await openPaymentsFirstPage(page)
  await expect(loadMore(page)).toBeVisible()
  await loadEverything(page)
  expect(await visibleLabels(ourCancelButtons(page, name))).toEqual(amounts.map((amount) => paymentLabel(name, amount)).sort())
  await expectNoLeakedNulls(page)

  await page.getByRole('button', { name: 'Show less', exact: true }).click()
  await expect(viewMore(page)).toBeVisible()
  await expect(loadMore(page)).toHaveCount(0)
  // Ten rows again (fewer of ours when the clinic has other receipts).
  await expect.poll(() => ourCancelButtons(page, name).count()).toBeLessThanOrEqual(10)
  await guards.assertClean()
})

test('a failed "Load more" read for payments says so, and the retry loads the rows', async ({ page, factory }) => {
  const guards = guardsFor(page, 'rest/v1/payments')
  const { name, amounts } = await seedPayments(factory)
  await openPaymentsFirstPage(page)

  const fault = await failNextSupabaseCall(page, { resource: 'rest/v1/payments', method: 'GET', mode: 'abort' })
  await loadMore(page).click()
  await expectButtonRecovers(loadMore(page), { idleName: /^Load more \(\d+ remaining\)$/, message: NETWORK_ERROR_MESSAGE, fault })
  await expectFailureMessage(page, "Couldn't load more payments")
  await fault.dispose()

  await loadEverything(page)
  expect(await visibleLabels(ourCancelButtons(page, name))).toEqual(amounts.map((amount) => paymentLabel(name, amount)).sort())
  await guards.assertClean()
})

// G-6: a failed refunds (or payment_applications) read used to be ignored, so the loaded payments
// showed as never refunded, with a live Cancel button. It is reported like a failed payments read.
test('a failed refunds read during "Load more" is reported, not silently dropped (G-6)', async ({ page, factory }) => {
  const guards = guardsFor(page, 'rest/v1/refunds')
  await seedPayments(factory)
  await openPaymentsFirstPage(page)

  const fault = await failNextSupabaseCall(page, { resource: 'rest/v1/refunds', method: 'GET', mode: 'abort' })
  await loadMore(page).click()
  await expect.poll(() => fault.hit()).toBe(true)
  await expectFailureMessage(page, "Couldn't load more payments")
  await guards.assertClean()
})

// G-6 ("rows also vanish after any audited change"; plan B-12 labels this G-17d): the server
// re-render after the action used to replace the loaded list with the first 50 rows again. Rows
// the admin already loaded stay loaded, re-read with their new status.
test('rows loaded with "Load more" stay loaded after a payment is cancelled (G-6)', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const { name, amounts } = await seedPayments(factory)
  await openPaymentsFirstPage(page)
  await loadEverything(page)
  await expect(ourCancelButtons(page, name)).toHaveCount(ROWS)

  // The oldest receipt is one that only "Load more" brought in.
  const oldest = amounts.at(-1)!
  const dialog = await openAuditDialog(page, paymentActionButton(page, 'Cancel', name, oldest), 'Cancel payment')
  await dialog.getByLabel('Reason *', { exact: true }).fill(factory.uniqueName('void-after-load-more'))
  await auditSaveButton(dialog).click()
  await expect(page.getByText('Audited change saved', { exact: true }).first()).toBeVisible()
  await expect(dialog).toBeHidden()

  await expect(ourCancelButtons(page, name)).toHaveCount(ROWS - 1)
  await guards.assertClean()
})

// ---------------------------------------------------------------------------------------------
// Packages

function ourPackageNames(page: Page, names: string[]): Locator {
  const prefix = names[0].replace(/\d+$/, '')
  return page.getByText(new RegExp(`^${escapeRegExp(prefix)}\\d+$`)).filter({ visible: true })
}

async function openPackagesFirstPage(page: Page): Promise<void> {
  await page.goto('/billing?tab=packages')
  await openBillingTab(page, 'Packages')
  await viewMore(page).click()
  await expect(page.getByRole('button', { name: 'Show less', exact: true })).toBeVisible()
}

test('Packages "Load more" pages past the first 50 with no duplicate or missing cards, and Show less folds the list', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const { names } = await seedPackages(factory)

  await openPackagesFirstPage(page)
  await expect(loadMore(page)).toBeVisible()
  await loadEverything(page)
  expect(await visibleLabels(ourPackageNames(page, names))).toEqual([...names].sort())
  await expectNoLeakedNulls(page)

  await page.getByRole('button', { name: 'Show less', exact: true }).click()
  await expect(viewMore(page)).toBeVisible()
  await expect(loadMore(page)).toHaveCount(0)
  await expect.poll(() => ourPackageNames(page, names).count()).toBeLessThanOrEqual(10)
  await guards.assertClean()
})

test('a failed "Load more" read for packages says so, and the retry loads the cards', async ({ page, factory }) => {
  const guards = guardsFor(page, 'rest/v1/packages')
  const { names } = await seedPackages(factory)
  await openPackagesFirstPage(page)

  const fault = await failNextSupabaseCall(page, { resource: 'rest/v1/packages', method: 'GET', mode: 'abort' })
  await loadMore(page).click()
  await expectButtonRecovers(loadMore(page), { idleName: /^Load more \(\d+ remaining\)$/, message: NETWORK_ERROR_MESSAGE, fault })
  await expectFailureMessage(page, "Couldn't load more packages")
  await fault.dispose()

  await loadEverything(page)
  expect(await visibleLabels(ourPackageNames(page, names))).toEqual([...names].sort())
  await guards.assertClean()
})

// ---------------------------------------------------------------------------------------------
// B-13 · Payments Balance pagination

test('Payments Balance pages 25 owing patients at a time and Next shows the 26th', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  // Dues far above any other fixture's put these 26 first, in this order.
  const patients = await factory.createPatients(26, { phone: null })
  for (const [index, patient] of patients.entries()) {
    await factory.createAppointment({
      patientId: patient.id, date: clinicDate(-900 - index), time: '09:05', fee: 900_000 - index * 100, status: 'completed', payment_status: 'unpaid',
    })
  }
  const row = (patientId: string) => page.locator(`a[href="/billing/payment-due/${patientId}"]`)

  await page.goto('/billing')
  await openBillingTab(page, 'Payments Balance')
  const nav = page.getByRole('navigation', { name: 'Payments balance pages' })
  await expect(nav).toBeVisible()
  await expect(row(patients[0].id)).toBeVisible()
  await expect(row(patients[24].id)).toBeVisible()
  await expect(row(patients[25].id)).toHaveCount(0)
  await expectNoLeakedNulls(page)

  await nav.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(row(patients[25].id)).toBeVisible()
  await expect(row(patients[25].id)).toContainText('Due')
  await expect(row(patients[0].id)).toHaveCount(0)
  await expect(nav.getByRole('button', { name: '2', exact: true })).toHaveAttribute('aria-current', 'page')
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})
