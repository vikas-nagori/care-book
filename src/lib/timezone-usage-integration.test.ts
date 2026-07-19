import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

test('billing pages derive user-facing periods from the synchronized browser timezone', () => {
  const billingPage = source('src/app/billing/page.tsx')
  const metricPage = source('src/app/billing/metrics/[metric]/page.tsx')
  const billingView = source('src/app/billing/billing-view.tsx')

  assert.match(billingPage, /const userTimeZone = await getUserTimeZone\(\)/)
  assert.match(billingPage, /getZonedCalendarContext\(now, userTimeZone\)/)
  assert.match(billingPage, /calendar\.monthStart/)
  assert.match(billingPage, /calendar\.previousMonthStart/)
  assert.match(billingPage, /currentMonthLabel=\{calendar\.monthLabel\}/)
  assert.match(billingPage, /defaultPaymentDate=\{calendar\.date\}/)

  assert.match(metricPage, /const userTimeZone = await getUserTimeZone\(\)/)
  assert.match(metricPage, /getZonedCalendarContext\(now, userTimeZone\)/)
  assert.doesNotMatch(metricPage, /startOfMonth\(month\)/)

  assert.match(billingView, /currentMonthLabel: string/)
  assert.match(billingView, /defaultPaymentDate: string/)
  assert.match(billingView, /\{currentMonthLabel\}/)
  assert.match(billingView, /defaultPaymentDate=\{defaultPaymentDate\}/)
})

test('billing allocation previews retain the Kolkata clinic business day', () => {
  const billingPage = source('src/app/billing/page.tsx')
  const billingView = source('src/app/billing/billing-view.tsx')
  const billingForm = source('src/app/billing/billing-entry-form.tsx')

  assert.match(billingPage, /getZonedDate\(now, CLINIC_TIME_ZONE\)/)
  assert.match(billingPage, /clinicToday=\{clinicToday\}/)
  assert.match(billingView, /clinicToday: string/)
  assert.match(billingView, /clinicToday=\{clinicToday\}/)
  assert.match(billingForm, /today: clinicToday/)
  assert.match(billingForm, /defaultValue=\{defaultPaymentDate\}/)
  assert.doesNotMatch(billingForm, /const IST = 'Asia\/Kolkata'/)
})
