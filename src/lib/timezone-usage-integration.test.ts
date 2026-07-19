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

test('patient flows use the browser date default and preserve date-only calendar values', () => {
  const patientPage = source('src/app/patients/[id]/page.tsx')
  const patientDetail = source('src/app/patients/[id]/patient-detail.tsx')
  const treatmentPlanForm = source('src/app/patients/[id]/treatment-plan-form.tsx')
  const appointmentDetail = source('src/app/schedule/[id]/appointment-detail.tsx')
  const billingView = source('src/app/billing/billing-view.tsx')

  assert.match(patientPage, /const userTimeZone = await getUserTimeZone\(\)/)
  assert.match(patientPage, /const defaultDate = getZonedDate\(new Date\(\), userTimeZone\)/)
  assert.match(patientPage, /defaultDate=\{defaultDate\}/)
  assert.match(patientDetail, /defaultDate: string/)
  assert.match(patientDetail, /<TreatmentPlanForm[\s\S]*defaultDate=\{defaultDate\}/)
  assert.match(treatmentPlanForm, /defaultDate: string/)
  assert.match(treatmentPlanForm, /plan\?\.start_date \?\? defaultDate/)

  assert.match(patientDetail, /formatDateOnly\(patient\.dob, 'dd MMM yyyy'\)/)
  assert.match(appointmentDetail, /formatDateOnly\(appointment\.date, 'EEEE, dd MMM yyyy'\)/)
  assert.match(billingView, /formatDateOnly\(item\.sortDate, 'dd MMM yyyy'\)/)
  assert.doesNotMatch(patientDetail, /format\(new Date\(/)
  assert.doesNotMatch(appointmentDetail, /format\(new Date\(appointment\.date\)/)
  assert.doesNotMatch(billingView, /format\(new Date\(item\.sortDate\)/)
})
