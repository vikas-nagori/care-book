import type { Page } from '@playwright/test'

import { CLINIC_A } from '../support/accounts'
import { attachErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'
import { SEED } from '../support/ids'
import { isMobileProject } from '../support/mobile'
import { adminClient } from '../support/supabase-admin'

test('shows the seeded appointment fee and payment signals on the admin dashboard', async ({ page }) => {
  const guards = attachErrorGuards(page)

  await page.goto('/')

  const seededAppointment = page
    .getByRole('link', { name: /Asha Rao/ })
    .filter({ hasText: '₹800', visible: true })
    .first()
  await expect(seededAppointment).toBeVisible()
  await expect(page.getByRole('link', { name: /This month.*collected/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Outstanding.*payment due/i })).toBeVisible()
  await guards.assertClean()
})

test('shows seeded schedule, appointment, and patient payment signals to admins', async ({ page }, testInfo) => {
  const guards = attachErrorGuards(page)

  await page.goto(`/schedule?date=${clinicDate()}`)
  const sharedAppointment = page.getByRole('link', { name: /Asha Rao/ }).filter({ visible: true })
  await expect(sharedAppointment).toBeVisible()
  if (testInfo.project.name.endsWith('-desktop')) {
    await expect(page.getByRole('heading', { name: 'Day total', exact: true })).toBeVisible()
    await expect(page.getByText('Expected', { exact: true })).toBeVisible()
  }

  await sharedAppointment.click()
  await expect(page).toHaveURL(`/schedule/${SEED.appointmentShared}`)
  await expect(page.getByText('₹800', { exact: true })).toBeVisible()
  // Appointment detail now renders the shared PaymentBadge instead of the raw DB value, so
  // this reads "Prepaid" here exactly as it does on the dashboard and schedule.
  await expect(page.getByText('Prepaid', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByLabel('Session Fee (₹)', { exact: true })).toHaveValue('800')
  await page.getByRole('button', { name: 'Close' }).click()

  await page.goto('/schedule/new')
  await expect(page.getByLabel('Session Fee (₹)', { exact: true })).toBeVisible()

  await page.goto(`/patients/${SEED.patientAsha}`)
  await page.getByRole('tab', { name: 'Billing', exact: true }).click()
  await expect(page.getByText('10-Session Physiotherapy Package', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Payment History', exact: true })).toBeVisible()
  await expect(page.getByText('₹8,000', { exact: true }).first()).toBeVisible()
  await guards.assertClean()
})

/** What the Day total should read for `date`: every non-cancelled fee an admin can see that day. */
async function expectedDayTotal(date: string): Promise<number> {
  const { data, error } = await adminClient()
    .from('appointments')
    .select('fee, status')
    .eq('clinic_id', CLINIC_A.id)
    .eq('date', date)
  if (error) throw error
  return (data ?? [])
    .filter((row) => row.status !== 'cancelled' && row.fee != null)
    .reduce((sum, row) => sum + Number(row.fee), 0)
}

function dayTotalPanel(page: Page) {
  return page.getByText('Expected', { exact: true }).locator('..')
}

// S-25 / G-1: the admin schedule query never selected `fee`, so "Expected" always read ₹0.
test('Day total "Expected" sums the fees of the day\'s non-cancelled appointments', async ({ page, factory }, testInfo) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  // A date no other spec books on, so the only rows are this test's (plus any a parallel run made,
  // which the DB-derived total also counts).
  const date = clinicDate(233)
  await factory.createAppointment({ patientId: patient.id, date, time: '09:10', fee: 800 })
  await factory.createAppointment({ patientId: patient.id, date, time: '10:20', fee: 650, status: 'completed' })
  await factory.createAppointment({ patientId: patient.id, date, time: '11:30', fee: 999, status: 'cancelled' })
  await factory.createAppointment({ patientId: patient.id, date, time: '12:40', fee: null })

  await page.goto(`/schedule?date=${date}`)
  await expect(page.getByRole('link', { name: new RegExp(patient.name as string) }).filter({ visible: true })).toHaveCount(4)

  if (isMobileProject(testInfo)) {
    // The panel is part of the desktop side column; phones never render it.
    await expect(page.getByRole('heading', { name: 'Day total', exact: true })).toBeHidden()
    await expect(page.getByText('Expected', { exact: true })).toBeHidden()
    await guards.assertClean()
    return
  }

  const total = await expectedDayTotal(date)
  expect(total, 'the factory rows alone add up to ₹1,450').toBeGreaterThanOrEqual(1_450)
  await expect(page.getByRole('heading', { name: 'Day total', exact: true })).toBeVisible()
  await expect(dayTotalPanel(page).locator('.ph-money')).toHaveText(`₹${total.toLocaleString('en-IN')}`)
  await guards.assertClean()
})
