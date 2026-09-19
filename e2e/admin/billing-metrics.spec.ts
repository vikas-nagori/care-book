// Admin-only coverage for the "Total billed" drill-down's per-appointment-type breakdown strip, its
// per-date accordion, the monthly trend's month picker / till-date toggle, and the payment-mode
// default. Data is built per-test with the factory so assertions don't depend on
// other specs' rows: the strip aggregates the whole clinic's completed sessions this month, so we
// only assert that the two types we created are present, never exact clinic-wide totals.

import { BillingEntryForm } from '../pages/billing-entry-form'
import { attachErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'

test('Billed drill-down shows a per-appointment-type breakdown strip', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const clinicType = await factory.findAppointmentType(true) // seeded shared "Clinic"
  const homeType = await factory.findAppointmentType(false) // seeded private "Home"

  await factory.createAppointment({
    patientId: patient.id,
    appointmentTypeId: clinicType.id,
    type: clinicType.name,
    date: clinicDate(),
    time: '09:15',
    fee: 800,
    status: 'completed',
    payment_status: 'unpaid',
  })
  await factory.createAppointment({
    patientId: patient.id,
    appointmentTypeId: homeType.id,
    type: homeType.name,
    date: clinicDate(),
    time: '10:15',
    fee: 1000,
    status: 'completed',
    payment_status: 'unpaid',
  })

  await page.goto('/billing/metrics/billed-this-month')

  const strip = page.getByLabel('Billed by appointment type')
  await expect(strip).toBeVisible()
  await expect(strip.getByText(clinicType.name, { exact: true })).toBeVisible()
  await expect(strip.getByText(homeType.name, { exact: true })).toBeVisible()

  await guards.assertClean()
})

test('Received drill-down does NOT show the appointment-type strip', async ({ page }) => {
  const guards = attachErrorGuards(page)
  await page.goto('/billing/metrics/received-this-month')
  await expect(page.getByLabel('Billed by appointment type')).toHaveCount(0)
  await guards.assertClean()
})

test('New billing entry defaults the payment mode to UPI', async ({ page }) => {
  const guards = attachErrorGuards(page)
  await page.goto('/billing')

  const form = new BillingEntryForm(page)
  await form.open()
  // The Payment Method select's trigger shows the preselected value.
  await expect(page.getByLabel('Payment Method *', { exact: true })).toContainText('UPI')

  await guards.assertClean()
})

/** Today's date as the accordion headers render it, e.g. "18 Sep". */
function dayLabel(date = clinicDate()): string {
  const [year, month, day] = date.split('-').map(Number)
  const monthName = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  )
  return `${String(day).padStart(2, '0')} ${monthName}`
}

test('Billed drill-down groups sessions under a collapsed date that expands on click', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const clinicType = await factory.findAppointmentType(true)

  await factory.createAppointment({
    patientId: patient.id,
    appointmentTypeId: clinicType.id,
    type: clinicType.name,
    date: clinicDate(),
    time: '11:15',
    fee: 900,
    status: 'completed',
    payment_status: 'unpaid',
  })

  await page.goto('/billing/metrics/billed-this-month')

  // The session is summarised under its date, not listed outright.
  await expect(page.getByText(patient.name as string, { exact: true })).toHaveCount(0)

  const header = page.getByTestId('date-group-header').filter({ hasText: dayLabel() }).first()
  await expect(header).toBeVisible()
  await expect(header).toContainText(/session/)
  await expect(header).toHaveAttribute('aria-expanded', 'false')

  await header.click()

  await expect(header).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText(patient.name as string, { exact: true }).first()).toBeVisible()

  // Clicking again puts it away.
  await header.click()
  await expect(page.getByText(patient.name as string, { exact: true })).toHaveCount(0)

  await guards.assertClean()
})

test('Monthly billed trend switches between the full month and billed till date', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  await factory.createAppointment({
    patientId: patient.id,
    date: clinicDate(),
    time: '12:20',
    fee: 700,
    status: 'completed',
    payment_status: 'unpaid',
  })

  await page.goto('/billing/metrics/billed-last-month')

  await expect(page.getByText('Total billed · all time', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Full month' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Billed till date' }).click()

  await expect(page.getByText(/^Total billed · first \d+ days of each month$/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Billed till date' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Full month' }).click()
  await expect(page.getByText('Total billed · all time', { exact: true })).toBeVisible()

  await guards.assertClean()
})

test('Monthly billed trend drills into one month by appointment type', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const clinicType = await factory.findAppointmentType(true)
  await factory.createAppointment({
    patientId: patient.id,
    appointmentTypeId: clinicType.id,
    type: clinicType.name,
    date: clinicDate(),
    time: '13:20',
    fee: 650,
    status: 'completed',
    payment_status: 'unpaid',
  })

  await page.goto('/billing/metrics/billed-last-month')

  // The picker opens on the current month, and the panel bifurcates it by appointment type.
  const picker = page.getByRole('combobox', { name: 'Month' })
  await expect(picker).toBeVisible()
  const selectedMonth = (await picker.textContent())?.trim() ?? ''
  expect(selectedMonth).not.toBe('')

  const panel = page.getByLabel('Selected month total')
  await expect(panel).toContainText(selectedMonth)
  await expect(page.getByLabel('Billed by appointment type')).toContainText(clinicType.name)

  // The chart marks the month the picker is sitting on.
  const chart = page.getByRole('img', { name: 'Monthly total billed trend' })
  await expect(chart.locator('circle[data-selected="true"]')).toHaveCount(1)

  // Picking another month moves the panel with it.
  await picker.click()
  const options = page.getByRole('option')
  const optionCount = await options.count()
  if (optionCount > 1) {
    const other = options.nth(1)
    const otherLabel = (await other.textContent())?.trim() ?? ''
    await other.click()
    await expect(panel).toContainText(otherLabel)
  } else {
    await page.keyboard.press('Escape')
  }

  await guards.assertClean()
})
