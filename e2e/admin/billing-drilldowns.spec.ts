// Admin-only coverage for the billing drill-down changes: the "Billed last month" tile now opens a
// month-by-month trendline instead of a list; the "Received" list groups records into one collapsed
// accordion per date and paginates over whole dates; and a package opens a detail page showing the
// dates its sessions were taken. Data is built per-test with the factory.

import { CLINIC_A } from '../support/accounts'
import { attachErrorGuards } from '../support/assertions'
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
  await expect(page.getByRole('img', { name: 'Monthly total billed trend' })).toBeVisible()
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
  await expect(page.getByRole('img', { name: 'Monthly total billed trend' })).toHaveCount(0) // a list, not the chart
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
