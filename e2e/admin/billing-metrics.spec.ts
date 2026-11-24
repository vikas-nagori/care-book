// Admin-only coverage for the "Total billed" drill-down's per-appointment-type breakdown strip, its
// per-date accordion, the monthly trend's month picker / till-date toggle, and the payment-mode
// default. Data is built per-test with the factory so assertions don't depend on
// other specs' rows: the strip aggregates the whole clinic's completed sessions this month, so we
// only assert that the two types we created are present, never exact clinic-wide totals.

import { BillingEntryForm } from '../pages/billing-entry-form'
import { CLINIC_A } from '../support/accounts'
import { attachErrorGuards, gotoNotFoundRoute } from '../support/assertions'
import { collapseDateGroup, expandDateGroup } from '../support/date-groups'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'
import { adminClient } from '../support/supabase-admin'

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

  await expandDateGroup(header)
  await expect(page.getByText(patient.name as string, { exact: true }).first()).toBeVisible()

  // Clicking again puts it away.
  await collapseDateGroup(header)
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

  const range = page.getByRole('combobox', { name: 'Trend range' })
  await expect(range).toContainText('Full month')
  await expect(page.getByText('Total billed · all time', { exact: true })).toBeVisible()

  await range.click()
  // On the 1st no day of the month has finished, so the till-date view is switched off.
  if (clinicDate().endsWith('-01')) {
    await expect(page.getByRole('option', { name: 'Billed till date (from the 2nd)' })).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
    await guards.assertClean()
    return
  }
  await page.getByRole('option', { name: 'Billed till date' }).click()

  await expect(range).toContainText('Billed till date')
  await expect(page.getByText(/^Total billed · first \d+ days? of each month$/)).toBeVisible()

  await range.click()
  await page.getByRole('option', { name: 'Full month' }).click()
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
  const chart = page.getByRole('group', { name: 'Monthly total billed trend' })
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

test('Monthly billed trend stacks types and reads out a month on tap (mobile) or hover (desktop)', async ({ page, factory, isMobile }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const clinicType = await factory.findAppointmentType(true)
  const homeType = await factory.findAppointmentType(false)
  for (const [type, fee, time] of [[clinicType, 650, '14:10'], [homeType, 900, '15:10']] as const) {
    await factory.createAppointment({
      patientId: patient.id,
      appointmentTypeId: type.id,
      type: type.name,
      date: clinicDate(),
      time,
      fee,
      status: 'completed',
      payment_status: 'unpaid',
    })
  }

  await page.goto('/billing/metrics/billed-last-month')

  const chart = page.getByRole('group', { name: 'Monthly total billed trend' })
  await expect(chart).toBeVisible()
  const legend = page.getByRole('list', { name: 'Chart legend' })
  await expect(legend).toContainText(clinicType.name)
  await expect(legend).toContainText(homeType.name)
  await expect(legend).toContainText('Total')

  // The current month is selected on open; its column carries both types as stacked parts.
  const picker = page.getByRole('combobox', { name: 'Month' })
  const currentLabel = (await picker.textContent())?.trim() ?? ''
  const currentBars = chart.locator('[data-bar-month]').last()
  await expect(currentBars.locator(`[data-segment="${clinicType.name}"]`)).toHaveCount(1)
  await expect(currentBars.locator(`[data-segment="${homeType.name}"]`)).toHaveCount(1)

  const readout = page.locator('[data-chart-readout]')
  await expect(readout).toHaveCount(0)

  const currentMonth = chart.getByRole('button', { name: `${currentLabel}: total` })
  if (isMobile) await currentMonth.tap()
  else await currentMonth.hover()

  await expect(readout).toBeVisible()
  await expect(readout).toContainText(currentLabel)
  await expect(readout).toContainText('Total')
  await expect(readout).toContainText(clinicType.name)
  await expect(readout).toContainText(homeType.name)

  // The readout sits inside the viewport, not pushed off the side of a phone screen.
  const box = await readout.boundingBox()
  const viewport = page.viewportSize()
  expect(box && viewport && box.x >= 0 && box.x + box.width <= viewport.width).toBeTruthy()

  // Dismiss: a tap elsewhere on mobile, moving the mouse away on desktop.
  if (isMobile) await page.getByText(/^Total billed · all time$/).tap()
  else await page.mouse.move(0, 0)
  await expect(readout).toHaveCount(0)

  await guards.assertClean()
})

/** First day of the month `monthsBack` before the clinic's current month, plus offset days. */
function monthDate(monthsBack: number, day: number): string {
  const [year, month] = clinicDate().split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 - monthsBack, day)).toISOString().slice(0, 10)
}

async function panelAmount(page: import('@playwright/test').Page): Promise<number> {
  const text = await page.getByLabel('Selected month total').locator('.ph-stat-value').innerText()
  return Number(text.replace(/[^\d.]/g, ''))
}

test('Monthly billed trend compares a month with the one before, per appointment type', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const clinicType = await factory.findAppointmentType(true)
  for (const [monthsBack, fee] of [[2, 1100], [1, 1300]] as const) {
    await factory.createAppointment({
      patientId: patient.id,
      appointmentTypeId: clinicType.id,
      type: clinicType.name,
      date: monthDate(monthsBack, 10),
      time: '09:40',
      fee,
      status: 'completed',
      payment_status: 'unpaid',
    })
  }

  await page.goto('/billing/metrics/billed-last-month')
  const panel = page.getByLabel('Selected month total')

  // The current month is still being billed: no percentage, a pointer to the like-for-like view.
  await expect(panel).toContainText('month in progress')
  await expect(panel.locator('[data-delta]')).toHaveCount(0)

  // Last month against the month before it.
  const picker = page.getByRole('combobox', { name: 'Month' })
  await picker.click()
  const options = page.getByRole('option')
  const lastMonth = (await options.nth(1).textContent())?.trim() ?? ''
  const monthBefore = (await options.nth(2).textContent())?.trim() ?? ''
  await options.nth(1).click()

  await expect(panel).toContainText(`vs ${monthBefore}`)
  await expect(panel.locator('[data-delta]')).toHaveCount(1)
  const table = page.getByLabel('Billed by appointment type')
  await expect(table).toContainText(`vs ${monthBefore}`)
  await expect(table.locator(`[data-type-row="${clinicType.name}"] [data-delta]`)).toHaveCount(1)
  expect(lastMonth).not.toBe(monthBefore)

  await guards.assertClean()
})

// The server reads the real clock, so the clinic date cannot be frozen from the browser. Instead of
// skipping on the 1st (plan B-18), each day asserts what that day must show: from the 2nd the
// till-date view drops today's session; on the 1st no day has finished, so the comparison is not
// offered and the full month still counts today's session.
test('Billed till date leaves out today, counting finished days only', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const todaysFee = 777
  await factory.createAppointment({
    patientId: patient.id,
    date: clinicDate(),
    time: '08:05',
    fee: todaysFee,
    status: 'completed',
    payment_status: 'unpaid',
  })

  await page.goto('/billing/metrics/billed-last-month')
  // Full month: the current month includes today's session.
  const fullCurrent = await panelAmount(page)
  expect(fullCurrent).toBeGreaterThanOrEqual(todaysFee)

  if (clinicDate().endsWith('-01')) {
    await expect(page.getByText('From the 2nd, Billed till date compares it with last month.', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Compare billed till date' })).toHaveCount(0)
    await guards.assertClean()
    return
  }

  await page.getByRole('button', { name: 'Compare billed till date' }).click()
  await expect(page.getByRole('combobox', { name: 'Trend range' })).toContainText('Billed till date')
  const tillDateCurrent = await panelAmount(page)

  // Every session dated today is excluded, so at least our own fee drops out.
  expect(fullCurrent - tillDateCurrent).toBeGreaterThanOrEqual(todaysFee)
  await expect(page.getByText(/the last finished day, so months compare like for like\.$/)).toBeVisible()

  await guards.assertClean()
})

// B-18. Pagination runs over whole dates; a page past the end lands on the last real page, and a
// slug that is not a metric is not found.
test('a page past the end redirects to the last page, and an unknown metric is not found', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  // 16 distinct dates in the clinic month (days 01–16 always exist) guarantee a second page.
  const month = clinicDate().slice(0, 8)
  const { error } = await adminClient().from('payments').insert(Array.from({ length: 16 }, (_, i) => ({
    clinic_id: CLINIC_A.id,
    patient_id: patient.id as string,
    amount: 200 + i,
    payment_method: 'upi',
    date: `${month}${String(i + 1).padStart(2, '0')}`,
    notes: factory.uniqueName('page-past-end'),
  })))
  expect(error).toBeNull()

  await page.goto('/billing/metrics/received-this-month?page=999')
  // The page streams behind loading.tsx, so the redirect lands after the first paint.
  await expect(page).toHaveURL(/\/billing\/metrics\/received-this-month\?page=(?!999$)\d+$/)
  const lastPage = Number(new URL(page.url()).searchParams.get('page'))
  expect(lastPage).toBeGreaterThanOrEqual(2)
  expect(lastPage).toBeLessThan(999)
  const nav = page.getByRole('navigation', { name: 'Received pages' })
  await expect(nav.locator('[aria-current="page"]')).toHaveText(String(lastPage))
  await expect(nav.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
  await expect(page.getByTestId('date-group-header').first()).toBeVisible()
  await guards.assertClean()

  await gotoNotFoundRoute(page, '/billing/metrics/not-a-metric')
})

/** The "Total billed · this month" tile on the billing overview, as a number. */
async function overviewBilledThisMonth(page: import('@playwright/test').Page): Promise<number> {
  await page.goto('/billing')
  const tile = page.getByRole('link', { name: /Total billed/ })
  await expect(tile).toBeVisible()
  const text = await tile.locator('.ph-stat-value').innerText()
  return Number(text.replace(/[^\d.]/g, ''))
}

test('Overview "Total billed" counts exactly this month\'s completed session fees', async ({ page, factory }) => {
  // The tile is aggregated by Postgres (get_billed_month_totals_v1) rather than summed from every
  // appointment in the app, so assert its arithmetic end to end: a completed session this month
  // adds its fee, while scheduled, cancelled and previous-month sessions add nothing.
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const before = await overviewBilledThisMonth(page)

  await factory.createAppointment({ patientId: patient.id, date: clinicDate(), time: '07:05', fee: 1234, status: 'completed' })
  await factory.createAppointment({ patientId: patient.id, date: clinicDate(), time: '07:55', fee: 5000, status: 'scheduled' })
  await factory.createAppointment({ patientId: patient.id, date: clinicDate(), time: '08:45', fee: 7000, status: 'cancelled' })
  const [year, month] = clinicDate().split('-').map(Number)
  const lastMonth = new Date(Date.UTC(year, month - 2, 15)).toISOString().slice(0, 10)
  await factory.createAppointment({ patientId: patient.id, date: lastMonth, time: '09:35', fee: 9000, status: 'completed' })

  const after = await overviewBilledThisMonth(page)
  expect(after - before).toBe(1234)

  await guards.assertClean()
})
