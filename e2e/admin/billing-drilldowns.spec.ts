// Admin-only coverage for the billing drill-down changes: the "Billed last month" tile now opens a
// month-by-month trendline instead of a list; the "Received" list groups records into one collapsed
// accordion per date and paginates over whole dates; and a package opens a detail page showing the
// dates its sessions were taken. Data is built per-test with the factory.

import {
  BillingEntryForm,
  openBillingTab,
  openPatientBillingTab,
  paymentActionButton,
  revealAllRows,
} from '../pages/billing-entry-form'
import { CLINIC_A } from '../support/accounts'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { expandDateGroup } from '../support/date-groups'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'
import { adminClient } from '../support/supabase-admin'

/** Today's date as the accordion headers render it, e.g. "18 Sep". */
function dayLabel(date = clinicDate()): string {
  const [year, month, day] = date.split('-').map(Number)
  const monthName = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  )
  return `${String(day).padStart(2, '0')} ${monthName}`
}

test('Billed last month opens a monthly trendline chart, not a record list', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  await factory.createAppointment({
    patientId: patient.id,
    date: clinicDate(),
    time: '09:20',
    fee: 800,
    status: 'completed',
    payment_status: 'unpaid',
  })

  await page.goto('/billing/metrics/billed-last-month')

  // The trendline chart replaces the list; its all-time total tile is the tell.
  await expect(page.getByRole('group', { name: 'Monthly total billed trend' })).toBeVisible()
  await expect(page.getByText('Total billed · all time', { exact: true })).toBeVisible()
  // No paginated record list on the trend view.
  await expect(page.getByRole('navigation', { name: /pages$/ })).toHaveCount(0)

  await guards.assertClean()
})

test('Received drill-down paginates over whole dates, not individual records', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  // Pagination is by date group (15 per page), so a second page needs 16+ distinct dates — not
  // merely 16+ payments. Days 01–16 always exist in the current clinic month.
  const month = clinicDate().slice(0, 8)
  const rows = Array.from({ length: 16 }, (_, i) => ({
    clinic_id: CLINIC_A.id,
    patient_id: patient.id as string,
    amount: 100 + i,
    payment_method: 'upi',
    date: `${month}${String(i + 1).padStart(2, '0')}`,
    notes: factory.uniqueName('pagination'),
  }))
  const { error } = await adminClient().from('payments').insert(rows)
  expect(error).toBeNull()

  await page.goto('/billing/metrics/received-this-month')

  const nav = page.getByRole('navigation', { name: 'Received pages' })
  await expect(nav).toBeVisible()
  await nav.getByRole('link', { name: 'Next' }).click()
  await expect(page).toHaveURL('/billing/metrics/received-this-month?page=2')
  await expect(page.getByRole('group', { name: 'Monthly total billed trend' })).toHaveCount(0) // a list, not the chart
  await guards.assertClean()
})

test('Received drill-down keeps a date collapsed until it is opened', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const { error } = await adminClient().from('payments').insert({
    clinic_id: CLINIC_A.id,
    patient_id: patient.id as string,
    amount: 1234,
    payment_method: 'upi',
    date: clinicDate(),
    notes: factory.uniqueName('accordion'),
  })
  expect(error).toBeNull()

  await page.goto('/billing/metrics/received-this-month')

  // The payment's own row is hidden behind its date header…
  await expect(page.getByText(patient.name as string, { exact: true })).toHaveCount(0)

  const header = page.getByTestId('date-group-header').filter({ hasText: dayLabel() }).first()
  await expect(header).toHaveAttribute('aria-expanded', 'false')

  // …and appears once that date is expanded.
  await expandDateGroup(header)
  await expect(page.getByText(patient.name as string, { exact: true }).first()).toBeVisible()

  await guards.assertClean()
})

test('clicking a package shows the dates its sessions were taken', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const pkg = await factory.createPackage({
    patientId: patient.id,
    name: factory.uniqueName('sessions-package'),
    total_sessions: 10,
    used_sessions: 0,
    total_amount: 8000,
    per_session_amount: 800,
    paid_amount: 8000,
    payment_timing: 'prepaid',
  })
  // Fee-matched completed sessions are auto-allocated to the prepaid package by the billing trigger.
  await factory.createAppointment({ patientId: patient.id, date: clinicDate(-3), time: '09:00', fee: 800, status: 'completed', payment_status: 'unpaid' })
  await factory.createAppointment({ patientId: patient.id, date: clinicDate(-1), time: '10:00', fee: 800, status: 'completed', payment_status: 'unpaid' })

  // Reach the package from the patient's Billing tab.
  await page.goto(`/patients/${patient.id}`)
  await page.getByRole('tab', { name: 'Billing', exact: true }).click()
  await page.getByRole('link', { name: new RegExp(pkg.name as string) }).click()

  await expect(page).toHaveURL(`/billing/packages/${pkg.id}`)
  await expect(page.getByRole('heading', { name: /Session history/ })).toBeVisible()
  await expect(page.getByText(clinicDateLabel(-3), { exact: true })).toBeVisible()
  await expect(page.getByText(clinicDateLabel(-1), { exact: true })).toBeVisible()
  await guards.assertClean()
})

// Package detail formats session dates as `dd MMM yyyy`.
function clinicDateLabel(offset: number): string {
  const [year, month, day] = clinicDate(offset).split('-').map(Number)
  const monthName = new Date(Date.UTC(year, month - 1, day)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  return `${String(day).padStart(2, '0')} ${monthName} ${year}`
}

// B-4. A package session whose appointment was deleted keeps its ledger row (the FK is
// `on delete set null`); the history must name it, not print "null". A completed session with a
// NULL fee (legacy row) bills ₹0 on the billed drill-down.
test('a package session whose appointment was deleted reads "Deleted appointment", and a NULL-fee session bills ₹0', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient({ phone: null })
  const pkg = await factory.createPackage({
    patientId: patient.id,
    name: factory.uniqueName('deleted-session-package'),
    total_sessions: 4,
    total_amount: 3200,
    per_session_amount: 800,
    paid_amount: 3200,
    payment_timing: 'prepaid',
  })
  const appointment = await factory.createAppointment({
    patientId: patient.id, date: clinicDate(-2), time: '08:45', fee: 800, status: 'completed', payment_status: 'unpaid',
  })
  // The billing trigger availed the session against the prepaid package.
  await page.goto(`/billing/packages/${pkg.id}`)
  await expect(page.getByRole('heading', { name: 'Session history · 1' })).toBeVisible()

  await factory.deleteAppointmentHard(appointment.id)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Session history · 1' })).toBeVisible()
  await expect(page.getByText(`Deleted appointment · ${appointment.id}`, { exact: true })).toBeVisible()
  await expectNoLeakedNulls(page)

  const legacy = await factory.createPatient({ phone: null })
  await factory.createAppointment({
    patientId: legacy.id, date: clinicDate(), time: '07:25', fee: null, status: 'completed', payment_status: 'unpaid',
  })
  await page.goto('/billing/metrics/billed-this-month')
  await expandDateGroup(page.getByTestId('date-group-header').filter({ hasText: dayLabel() }).first())
  const row = page.getByTestId('date-group-list').locator('div').filter({ hasText: legacy.name as string }).filter({ hasText: '₹' }).last()
  await expect(row).toBeVisible()
  await expect(row).toContainText('₹0')
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

// B-19. The patient's Billing tab folds a long payment history behind "Show all N payments", and a
// payment cancelled through the audited UI reads "· voided" there and "Cancelled" on /billing.
test('a patient with 21 payments folds them behind "Show all", and a voided payment reads voided and Cancelled', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient({ phone: null })
  const name = patient.name as string
  await factory.createPayments(20, { patientId: patient.id, startDayOffset: -400 })
  await factory.createPayment({ patientId: patient.id, amount: 1234, date: clinicDate() })

  await openPatientBillingTab(page, patient.id)
  const cards = page.getByText(/^₹(750|1,234)$/).filter({ visible: true })
  const toggle = page.getByRole('button', { name: /^(Show all 21 payments|Show less)$/ })
  await expect(toggle).toHaveAccessibleName('Show all 21 payments')
  await expect(cards).toHaveCount(20)
  await toggle.click()
  await expect(toggle).toHaveAccessibleName('Show less')
  await expect(cards).toHaveCount(21)
  await expectNoLeakedNulls(page)
  await toggle.click()
  await expect(cards).toHaveCount(20)

  // Cancel the ₹1,234 receipt with only the required reason.
  await page.goto('/billing?tab=payments')
  await new BillingEntryForm(page).voidPayment(name, 1234)
  await expect(paymentActionButton(page, 'Cancel', name, 1234)).toHaveCount(0)
  await openBillingTab(page, 'Payments')
  await revealAllRows(page)
  // The row this viewport shows (the desktop grid or the phone twin).
  const voidedRow = page.locator('div').filter({ visible: true })
    .filter({ hasText: name }).filter({ hasText: '₹1,234' }).filter({ hasText: 'Cancelled' }).last()
  await expect(voidedRow).toBeVisible()
  await expectNoLeakedNulls(page)

  await openPatientBillingTab(page, patient.id)
  const voidedCard = page.locator('div').filter({ has: page.getByText('₹1,234', { exact: true }) }).filter({ hasText: '· voided' }).last()
  await expect(voidedCard).toBeVisible()
  await expect(page.getByText(/· voided$/).filter({ visible: true })).toHaveCount(1)
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})
