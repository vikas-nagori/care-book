import type { Page } from '@playwright/test'
import { format, parseISO } from 'date-fns'
import { PatientForm, type PatientFormData } from '../pages/patient-form'
import { TreatmentPlanForm } from '../pages/treatment-plan-form'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate, wholeYearsSince } from '../support/clinic-date'
import { test, expect, type E2EFactory } from '../support/factories'
import { holdNextSupabaseCall, isSupabaseRequest } from '../support/fault-injection'

function stableDigits(value: string): string {
  let hash = 0
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return String(hash).padStart(9, '0').slice(-9)
}

// Fully populated on purpose; the sparse case lives in minimal-input.spec.ts.
type ReferralDetail = 'referralOther' | 'referrerPatientName' | 'doctorName' | 'newDoctor'
type FullPatientFormData = Required<Omit<PatientFormData, ReferralDetail>> & Pick<PatientFormData, ReferralDetail>

function patientData(factory: E2EFactory, kind: string): FullPatientFormData {
  const unique = factory.uniqueName(kind)
  return {
    name: unique,
    phone: `9${stableDigits(unique)}`,
    email: `${factory.token}-${kind.replace(/[^a-z0-9]/gi, '-').toLowerCase()}@carebook.test`,
    age: '34',
    gender: 'Female',
    referralSource: 'Walk-in',
    address: `${unique} address`,
    medicalHistory: `${unique} medical history`,
    notes: `${unique} patient notes`,
  }
}

test('creates a representative patient and finds the exact row through list search', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const data = patientData(factory, 'created-patient')
  data.referralSource = 'Google page'
  factory.watchUiPatient(data.name)

  await page.goto('/patients/new')
  const form = new PatientForm(page)
  await form.fill(data)
  await form.submitCreate()

  const search = page.getByPlaceholder('Search by name or phone…')
  await search.fill(data.name)
  await expect(page.getByRole('link', { name: new RegExp(data.name) })).toBeVisible()
  await search.fill(`${factory.token}-definite-non-match`)
  await expect(page.getByText(data.name, { exact: true })).toHaveCount(0)

  await expect.poll(async () => (await factory.findPatientByName(data.name))?.email).toBe(data.email)
  const patient = await factory.findPatientByName(data.name)
  expect(patient).toMatchObject({
    phone: data.phone,
    dob: null,
    age_years: 34,
    age_recorded_on: clinicDate(),
    gender: 'female',
    address: data.address,
    medical_history: data.medicalHistory,
    notes: data.notes,
    referral_source: 'google',
    referred_by_patient_id: null,
    referral_other: null,
  })
  await guards.assertClean()
})

test('edits a factory-owned patient and shows the persisted fields on detail and list', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const original = await factory.createPatient({
    email: `${factory.token}-before@carebook.test`,
    dob: '1988-01-02',
    gender: 'male',
  })
  const updated = patientData(factory, 'edited-patient')
  updated.age = '50'
  updated.gender = 'Other'
  updated.referralSource = 'Other'
  updated.referralOther = `${updated.name} health camp`

  await page.goto(`/patients/${original.id}/edit`)
  // The stored date of birth is offered as an age; the form no longer asks for a date.
  await expect(page.getByLabel('Age (years)', { exact: true })).toHaveValue(String(wholeYearsSince('1988-01-02')))
  await expect(page.getByLabel(/date of birth/i)).toHaveCount(0)
  const form = new PatientForm(page)
  await form.fill(updated)
  await form.submitUpdate()

  const search = page.getByPlaceholder('Search by name or phone…')
  await search.fill(updated.name)
  const row = page.getByRole('link', { name: new RegExp(updated.name) })
  await expect(row).toContainText(updated.phone)
  await row.click()
  await expect(page).toHaveURL(`/patients/${original.id}`)
  await expect(page.getByText(updated.name, { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText(updated.email, { exact: true })).toBeVisible()
  await expect(page.getByText(updated.address, { exact: true })).toBeVisible()
  await expect(page.getByTestId('patient-age')).toHaveText('Age 50 years')
  await expect(page.getByText('02 Jan 1988', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Other', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText(updated.referralOther, { exact: true })).toBeVisible()
  await expect(page.getByText(updated.medicalHistory, { exact: true })).toBeVisible()
  await expect(page.getByText(updated.notes, { exact: true })).toBeVisible()

  const persisted = await factory.findPatientByName(updated.name)
  expect(persisted).toMatchObject({
    id: original.id,
    phone: updated.phone,
    email: updated.email,
    // A corrected age is stored beside the date of birth, which is never rewritten.
    dob: '1988-01-02',
    age_years: 50,
    age_recorded_on: clinicDate(),
    gender: 'other',
    address: updated.address,
    medical_history: updated.medicalHistory,
    notes: updated.notes,
    referral_source: 'other',
    referral_other: updated.referralOther,
  })
  await guards.assertClean()
})

test('records an existing-patient referral and links the detail page to the referrer', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const referrer = await factory.createPatient()
  const data = patientData(factory, 'referred-patient')
  data.referralSource = 'Referred by existing patient'
  data.referrerPatientName = referrer.name as string
  factory.watchUiPatient(data.name)

  await page.goto('/patients/new')
  const form = new PatientForm(page)
  await form.fill(data)
  await form.submitCreate()

  await expect.poll(async () => (await factory.findPatientByName(data.name))?.referred_by_patient_id).toBe(referrer.id)
  const created = await factory.findPatientByName(data.name)
  expect(created).toMatchObject({ referral_source: 'patient', referred_by_doctor_id: null, referral_other: null })

  await page.goto(`/patients/${created!.id}`)
  await expect(page.getByText('Referred by existing patient', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: referrer.name as string, exact: true }).click()
  await expect(page).toHaveURL(`/patients/${referrer.id}`)
  await guards.assertClean()
})

test('warns deterministically before adding a patient with an existing phone', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const existing = await factory.createPatient()
  const duplicate = patientData(factory, 'duplicate-warning')
  duplicate.phone = existing.phone as string
  factory.watchUiPatient(duplicate.name)

  await page.goto('/patients/new')
  const form = new PatientForm(page)
  await form.fill(duplicate)
  await page.getByRole('button', { name: 'Add Patient', exact: true }).click()
  await form.expectDuplicateWarning(existing.name as string)
  await form.cancelDuplicate()

  await expect(page).toHaveURL(/\/patients\/new$/)
  await expect(page.getByLabel('Name *', { exact: true })).toHaveValue(duplicate.name)
  expect(await factory.findPatientByName(duplicate.name)).toBeNull()
  await guards.assertClean()
})

// The patients list renders one page of 50. Search used to filter only that loaded array, so a
// patient sorting past the boundary could not be found at all — and the Load more button is
// hidden while searching, leaving no way to reach them. Search now queries the database.
test('finds a patient that sorts past the first page of the list', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const PAGE_SIZE = 50

  // Enough leading-alphabet patients to fill page one on their own.
  const fillers = Array.from({ length: PAGE_SIZE + 2 }, (_, index) => index)
  await Promise.all(fillers.map((index) => factory.createPatient({
    name: `E2E ${factory.token} AAA filler ${String(index).padStart(3, '0')}`,
    phone: `90${String(index).padStart(7, '0')}`,
  })))

  const target = await factory.createPatient({
    name: `E2E ${factory.token} ZZZ beyond page one`,
    phone: '9990000001',
  })

  await page.goto('/patients')
  const targetRow = page.getByRole('link', { name: new RegExp(target.name as string) })
  await expect(page.getByTestId('patient-list-count')).toContainText(`showing ${PAGE_SIZE}`)
  await expect(targetRow).toHaveCount(0)

  // By name — the case that was broken.
  const search = page.getByPlaceholder('Search by name or phone…')
  await search.fill(target.name as string)
  await expect(targetRow).toBeVisible()
  await expect(page.getByTestId('patient-list-count')).toContainText('match')

  // By phone, also served from the database rather than the loaded page.
  await search.fill('9990000001')
  await expect(targetRow).toBeVisible()

  await search.fill(`${factory.token}-definitely-no-such-patient`)
  // Both viewport lists render the empty state; assert the one this viewport shows.
  await expect(page.getByText(/No patients match/).filter({ visible: true })).toBeVisible()

  // Clearing restores the paginated list rather than leaving the match set on screen.
  await search.fill('')
  await expect(page.getByTestId('patient-list-count')).toContainText(`showing ${PAGE_SIZE}`)

  // PA-10: Load more pages through the rest of the list until the button runs out.
  const loadMore = page.getByRole('button', { name: /^(Load more \(\d+ remaining\)|Loading…)$/ })
  let shown = PAGE_SIZE
  for (let pages = 0; await loadMore.isVisible(); pages += 1) {
    expect(pages, 'Load more never ran out').toBeLessThan(20)
    await expect(loadMore).toHaveAccessibleName(/^Load more \(\d+ remaining\)$/)
    await loadMore.click()
    await expect.poll(async () => Number((await page.getByTestId('patient-list-count').textContent())?.match(/showing (\d+)/)?.[1]))
      .toBeGreaterThan(shown)
    shown = Number((await page.getByTestId('patient-list-count').textContent())?.match(/showing (\d+)/)?.[1])
  }
  const [total] = (await page.getByTestId('patient-list-count').textContent())!.match(/\d+/)!
  expect(shown, 'every patient is loaded once Load more is gone').toBe(Number(total))
  await expect(loadMore).toHaveCount(0)
  await expect(targetRow.filter({ visible: true })).toBeVisible()
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('an existing date of birth shows as an age and survives an edit that leaves the age alone', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const dob = '1990-03-10'
  const age = wholeYearsSince(dob)
  const patient = await factory.createPatient({ dob, gender: 'female' })
  const name = patient.name as string

  await page.goto('/patients')
  await page.getByPlaceholder('Search by name or phone…').fill(name)
  await expect(page.getByRole('link', { name: new RegExp(name) }).filter({ visible: true })).toContainText(`${age} y`)

  await page.goto(`/patients/${patient.id}`)
  await expect(page.getByTestId('patient-age')).toHaveText(`Age ${age} years`)
  await expect(page.getByText('10 Mar 1990', { exact: true })).toHaveCount(0)

  await page.goto(`/patients/${patient.id}/edit`)
  await expect(page.getByLabel('Age (years)', { exact: true })).toHaveValue(String(age))
  await page.getByLabel('Notes', { exact: true }).fill(`${name} follow-up`)
  await page.getByRole('button', { name: 'Update Patient', exact: true }).click()
  await expect(page).toHaveURL(/\/patients$/)

  await expect.poll(async () => (await factory.findPatientByName(name))?.notes).toBe(`${name} follow-up`)
  expect(await factory.findPatientByName(name)).toMatchObject({ dob, age_years: null, age_recorded_on: null })
  await guards.assertClean()
})

test('refuses an age outside whole years 0 to 120 and saves nothing', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('bad-age-patient')
  factory.watchUiPatient(name)

  await page.goto('/patients/new')
  const form = new PatientForm(page)
  for (const age of ['121', '4.5', 'forty']) {
    await form.fill({ name, age })
    await form.submitCreateExpectingAgeError()
  }
  expect(await factory.findPatientByName(name)).toBeNull()

  await form.fill({ name, age: '0' })
  await form.submitCreate()
  await expect.poll(async () => (await factory.findPatientByName(name))?.age_years).toBe(0)
  await guards.assertClean()
})

/** Every request the page sends that matches one Supabase resource and method, counted from now. */
function countSupabaseRequests(page: Page, input: Parameters<typeof isSupabaseRequest>[1]) {
  let count = 0
  page.on('request', (request) => { if (isSupabaseRequest(request, input)) count += 1 })
  return () => count
}

// PA-5
test('a referring doctor added while creating a patient is stored once and reused, whatever the case', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const doctorName = factory.uniqueName('referring doctor')
  const first = factory.uniqueName('doctor-referred-first')
  const second = factory.uniqueName('doctor-referred-second')
  factory.watchUiPatient(first)
  factory.watchUiPatient(second)

  await page.goto('/patients/new')
  const form = new PatientForm(page)
  // Name only: specialty and address stay blank.
  await form.fill({ name: first, referralSource: 'Referred by doctor', newDoctor: { name: doctorName } })
  await form.submitCreate()

  await expect.poll(async () => (await factory.findDoctors({ name: doctorName })).length).toBe(1)
  const [doctor] = await factory.findDoctors({ name: doctorName })
  expect(doctor).toMatchObject({ name: doctorName, specialty: null, address: null })
  expect(await factory.findPatientByName(first)).toMatchObject({ referral_source: 'doctor', referred_by_doctor_id: doctor.id })

  // The next patient types the same doctor in another case: the stored doctor is offered and
  // picked, and no second doctor is created.
  await page.goto('/patients/new')
  await form.fill({ name: second, referralSource: 'Referred by doctor', doctorName: doctorName.toUpperCase() })
  await form.submitCreate()
  await expect.poll(async () => (await factory.findPatientByName(second))?.referred_by_doctor_id).toBe(doctor.id)
  expect((await factory.findDoctors({ name: doctorName })).map((row) => row.id)).toEqual([doctor.id])

  const secondRow = await factory.findPatientByName(second)
  await page.goto(`/patients/${secondRow!.id}`)
  await expect(page.getByText('Referred by doctor', { exact: true })).toBeVisible()
  // The doctor line is the bare name: no " · " left over for the missing specialty.
  const doctorLine = page.getByText(doctorName, { exact: true })
  await expect(doctorLine).toBeVisible()
  await expect(doctorLine).toHaveText(doctorName)
  await expect(page.getByText(`${doctorName} ·`)).toHaveCount(0)
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

// PA-6
test('"Add anyway" saves a patient whose phone is already on file, exactly once', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const existing = await factory.createPatient()
  const name = factory.uniqueName('add-anyway')
  factory.watchUiPatient(name)
  const inserts = countSupabaseRequests(page, { resource: 'rest/v1/patients', method: 'POST' })

  await page.goto('/patients/new')
  const form = new PatientForm(page)
  await form.fill({ name, phone: existing.phone as string })
  await form.submitButton().click()
  await form.expectDuplicateWarning(existing.name as string)
  expect(inserts(), 'nothing is inserted while the warning is open').toBe(0)
  await form.confirmDuplicate()

  await expect(page).toHaveURL(/\/patients$/)
  // findPatientByName reads one row and throws on two: exactly one patient was added.
  await expect.poll(async () => (await factory.findPatientByName(name))?.phone).toBe(existing.phone)
  expect(inserts()).toBe(1)
  expect(await factory.findPatientByName(existing.name as string)).toMatchObject({ id: existing.id })
  await guards.assertClean()
})

// PA-6, pending state (G-17a): closing the dialog on "Add anyway" must not clear `loading` while
// the insert is still in flight.
test('"Add anyway" shows the submit button as saving while the insert is in flight', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const existing = await factory.createPatient()
  const name = factory.uniqueName('add-anyway-pending')
  factory.watchUiPatient(name)

  await page.goto('/patients/new')
  const form = new PatientForm(page)
  await form.fill({ name, phone: existing.phone as string })
  await form.submitButton().click()
  await form.expectDuplicateWarning(existing.name as string)

  const hold = await holdNextSupabaseCall(page, { resource: 'rest/v1/patients', method: 'POST' })
  await form.confirmDuplicate()
  await hold.whenHeld()
  try {
    await expect(form.submitButton()).toHaveAccessibleName('Saving…')
    await expect(form.submitButton()).toBeDisabled()
  } finally {
    await hold.release()
  }
  await expect(page).toHaveURL(/\/patients$/)
  await expect.poll(async () => (await factory.findPatientByName(name))?.phone).toBe(existing.phone)
  await guards.assertClean()
})

// PA-7
test('a blank name, a name of only spaces and a malformed email are refused and nothing is saved', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('validated-patient')
  factory.watchUiPatient(name)
  const inserts = countSupabaseRequests(page, { resource: 'rest/v1/patients', method: 'POST' })

  await page.goto('/patients/new')
  const form = new PatientForm(page)
  const nameInput = page.locator('input#name')
  const emailInput = page.getByLabel('Email', { exact: true })

  // Empty: the browser refuses the required field.
  await form.submitButton().click()
  expect(await nameInput.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true)
  await expect(page).toHaveURL(/\/patients\/new$/)

  // Only spaces: passes `required`, so the form must refuse it itself (G-11).
  await form.fill({ name: '   ' })
  await form.submitButton().click()
  await expect(page.getByRole('alert').filter({ hasText: 'Enter the patient’s name.' })).toBeVisible()
  await expect(nameInput).toHaveAttribute('aria-invalid', 'true')
  await expect(page).toHaveURL(/\/patients\/new$/)

  // A malformed email: the browser refuses the type=email field.
  await form.fill({ name, email: 'abc' })
  await form.submitButton().click()
  expect(await emailInput.evaluate((input: HTMLInputElement) => input.validity.typeMismatch)).toBe(true)
  await expect(page).toHaveURL(/\/patients\/new$/)
  await form.expectSubmitReady('Add Patient')
  expect(inserts(), 'no refused submit reached the database').toBe(0)
  expect(await factory.findPatientByName(name)).toBeNull()

  // Corrected, with stray spaces round the name: saved once, trimmed.
  const email = `${factory.token}-validated@carebook.test`
  await form.fill({ name: `  ${name}  `, email })
  await expect(page.getByRole('alert').filter({ hasText: 'Enter the patient’s name.' })).toHaveCount(0)
  await form.submitCreate()
  await expect.poll(async () => (await factory.findPatientByName(name))?.email).toBe(email)
  expect(inserts()).toBe(1)
  await guards.assertClean()
})

// PA-8
test('an age of 120 is accepted while -1 and 1e2 are refused and save nothing', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('edge-age-patient')
  factory.watchUiPatient(name)

  await page.goto('/patients/new')
  const form = new PatientForm(page)
  for (const age of ['-1', '1e2']) {
    await form.fill({ name, age })
    await form.submitCreateExpectingAgeError()
  }
  expect(await factory.findPatientByName(name)).toBeNull()

  await form.fill({ name, age: '120' })
  await form.submitCreate()
  await expect.poll(async () => (await factory.findPatientByName(name))?.age_years).toBe(120)
  const patient = await factory.findPatientByName(name)
  await page.goto(`/patients/${patient!.id}`)
  await expect(page.getByTestId('patient-age')).toHaveText('Age 120 years')
  await guards.assertClean()
})

/** The plan card on the visible Plans tab that shows `diagnosis`. */
function planCard(page: Page, diagnosis: string) {
  return page.getByRole('tabpanel').filter({ visible: true }).locator('div.p-4').filter({ hasText: diagnosis })
}

// PA-9
test('a full treatment plan and a diagnosis-only plan both render, and only the full one shows a target date', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const full = { diagnosis: factory.uniqueName('full plan'), goals: factory.uniqueName('plan goals'), expectedEndDate: clinicDate(60) }
  const bare = factory.uniqueName('bare plan')

  await page.goto(`/patients/${patient.id}`)
  const form = new TreatmentPlanForm(page)
  await form.open()
  await form.fill(full)
  await form.submit()
  await form.open()
  await form.fill({ diagnosis: bare })
  await form.submit()

  await expect.poll(async () => (await factory.findTreatmentPlans(patient.id)).length).toBe(2)
  const plans = await factory.findTreatmentPlans(patient.id)
  expect(plans.find((plan) => plan.diagnosis === full.diagnosis)).toMatchObject({
    goals: full.goals, expected_end_date: full.expectedEndDate, start_date: clinicDate(), status: 'active',
  })
  expect(plans.find((plan) => plan.diagnosis === bare)).toMatchObject({
    goals: null, expected_end_date: null, start_date: clinicDate(), status: 'active',
  })

  await page.reload()
  await page.getByRole('tab', { name: 'Plans', exact: true }).click()
  const fullCard = planCard(page, full.diagnosis)
  const bareCard = planCard(page, bare)
  await expect(fullCard).toContainText(full.goals)
  await expect(fullCard).toContainText(`Target: ${format(parseISO(full.expectedEndDate), 'dd MMM yyyy')}`)
  await expect(bareCard).toContainText(`Started ${format(parseISO(clinicDate()), 'dd MMM yyyy')}`)
  await expect(bareCard).not.toContainText('Target')
  await expect(bareCard).not.toContainText('·')
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})
