// Patient screens when a request fails (plan 5.1, PA-11..PA-15), on the phone projects.
//
// The patient form, the treatment-plan dialog and the patient list talk to Supabase straight from
// the browser. Each case fails or holds exactly one of those calls and proves the control comes
// back, the typed input survives, the database holds what it should, and a retry works once.
// The controls are the same DOM for admin and staff and on every viewport, so per decision D2
// these run on admin-mobile and staff-mobile only.

import type { Page } from '@playwright/test'
import { PatientForm } from '../pages/patient-form'
import { TreatmentPlanForm } from '../pages/treatment-plan-form'
import { attachErrorGuards } from '../support/assertions'
import { test, expect, type E2EFactory } from '../support/factories'
import {
  INJECTED_SUPABASE_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  expectButtonRecovers,
  expectFailureMessage,
  expectedFaultConsoleErrors,
  failNextSupabaseCall,
  holdNextSupabaseCall,
  isSupabaseRequest,
  type SupabaseResource,
} from '../support/fault-injection'
import { isMobileProject } from '../support/mobile'

// Faults must reach Playwright's router, not the service worker.
test.use({ serviceWorkers: 'block' })

test.beforeEach(({}, testInfo) => {
  test.skip(!isMobileProject(testInfo), 'same controls on every viewport (D2): runs on the phone projects')
})

function guardsFor(page: Page, resource: SupabaseResource) {
  return attachErrorGuards(page, {
    expectedFailures: [
      ...expectedFaultConsoleErrors(resource),
      // The patient form logs a failed save on purpose (logger.error → console.error).
      { url: /^http:\/\/localhost:3000\//, text: /PatientForm\/save|ReferralFields\/createDoctor/ },
    ],
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }],
  })
}

/** Every request matching one Supabase resource and method from now on (survives hold.release()). */
function countRequests(page: Page, input: { resource: SupabaseResource; method?: string }) {
  let count = 0
  page.on('request', (request) => { if (isSupabaseRequest(request, input)) count += 1 })
  return () => count
}

async function openNewPatient(page: Page, factory: E2EFactory, kind: string) {
  const data = {
    name: factory.uniqueName(kind),
    phone: factory.uniqueMobile(),
    email: `${factory.token}-${kind}@carebook.test`,
    notes: factory.uniqueName(`${kind} notes`),
  }
  factory.watchUiPatient(data.name)
  await page.goto('/patients/new')
  const form = new PatientForm(page)
  await form.fill(data)
  return { form, data }
}

async function expectCreateInputKept(page: Page, data: { name: string; phone: string; email: string; notes: string }) {
  await expect(page).toHaveURL(/\/patients\/new$/)
  await expect(page.locator('input#name')).toHaveValue(data.name)
  await expect(page.getByLabel('Phone', { exact: true })).toHaveValue(data.phone)
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(data.email)
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(data.notes)
}

// ---- PA-11: Add Patient ------------------------------------------------------------------------

test('PA-11 a patient insert lost to a dropped connection says so in plain words and saves once on retry', async ({ page, factory }) => {
  const guards = guardsFor(page, 'rest/v1/patients')
  const { form, data } = await openNewPatient(page, factory, 'create-abort')

  const fault = await failNextSupabaseCall(page, { resource: 'rest/v1/patients', method: 'POST', mode: 'abort' })
  await form.submitButton().tap()
  await expectButtonRecovers(form.submitButton(), { idleName: 'Add Patient', message: NETWORK_ERROR_MESSAGE, fault })
  // G-12: never the raw transport error.
  await expect(page.getByText(/TypeError|Failed to fetch/)).toHaveCount(0)
  await expectCreateInputKept(page, data)
  expect(await factory.findPatientByName(data.name)).toBeNull()

  await fault.dispose()
  await form.submitButton().tap()
  await expect(page).toHaveURL(/\/patients$/)
  // findPatientByName throws on two rows: exactly one patient.
  await expect.poll(async () => (await factory.findPatientByName(data.name))?.email).toBe(data.email)
  await guards.assertClean()
})

test('PA-11 a patient insert refused by the server shows the reason, keeps the input and saves once on retry', async ({ page, factory }) => {
  const guards = guardsFor(page, 'rest/v1/patients')
  const { form, data } = await openNewPatient(page, factory, 'create-400')

  const fault = await failNextSupabaseCall(page, { resource: 'rest/v1/patients', method: 'POST', mode: 'http-400' })
  await form.submitButton().tap()
  await expectButtonRecovers(form.submitButton(), { idleName: 'Add Patient', message: INJECTED_SUPABASE_ERROR_MESSAGE, fault })
  await expectCreateInputKept(page, data)
  expect(await factory.findPatientByName(data.name)).toBeNull()

  await fault.dispose()
  await form.submitButton().tap()
  await expect(page).toHaveURL(/\/patients$/)
  await expect.poll(async () => (await factory.findPatientByName(data.name))?.email).toBe(data.email)
  await guards.assertClean()
})

test('PA-11 a held patient insert shows Saving…, sends nothing twice and saves once when released', async ({ page, factory }) => {
  const guards = guardsFor(page, 'rest/v1/patients')
  const { form, data } = await openNewPatient(page, factory, 'create-hold')
  const inserts = countRequests(page, { resource: 'rest/v1/patients', method: 'POST' })

  const hold = await holdNextSupabaseCall(page, { resource: 'rest/v1/patients', method: 'POST' })
  await form.submitButton().tap()
  await hold.whenHeld()
  await expect(form.submitButton()).toHaveAccessibleName('Saving…')
  await expect(form.submitButton()).toBeDisabled()
  // A second tap on the disabled button and Enter in a field send nothing more.
  await form.submitButton().click({ force: true })
  await page.locator('input#name').press('Enter')
  expect(hold.count()).toBe(1)
  expect(await factory.findPatientByName(data.name)).toBeNull()

  await hold.release()
  await expect(page).toHaveURL(/\/patients$/)
  await expect.poll(async () => (await factory.findPatientByName(data.name))?.email).toBe(data.email)
  expect(inserts()).toBe(1)
  await guards.assertClean()
})

// The new referring doctor is inserted first, straight from the browser, before the patient.
test('a referring doctor insert lost to a dropped connection saves neither doctor nor patient, and the retry saves both once', async ({ page, factory }) => {
  const guards = guardsFor(page, 'rest/v1/doctors')
  const name = factory.uniqueName('doctor-fault-patient')
  const doctorName = factory.uniqueName('doctor-fault')
  factory.watchUiPatient(name)
  await page.goto('/patients/new')
  const form = new PatientForm(page)
  await form.fill({ name, referralSource: 'Referred by doctor', newDoctor: { name: doctorName } })

  const fault = await failNextSupabaseCall(page, { resource: 'rest/v1/doctors', method: 'POST', mode: 'abort' })
  await form.submitButton().tap()
  await expectButtonRecovers(form.submitButton(), { idleName: 'Add Patient', message: NETWORK_ERROR_MESSAGE, fault })
  await expectFailureMessage(page, 'Doctor not saved')
  await expect(page).toHaveURL(/\/patients\/new$/)
  await expect(page.locator('input#new_doctor_name')).toHaveValue(doctorName)
  expect(await factory.findDoctors({ name: doctorName })).toEqual([])
  expect(await factory.findPatientByName(name)).toBeNull()

  await fault.dispose()
  await form.submitButton().tap()
  await expect(page).toHaveURL(/\/patients$/)
  await expect.poll(async () => (await factory.findDoctors({ name: doctorName })).length).toBe(1)
  const [doctor] = await factory.findDoctors({ name: doctorName })
  expect(await factory.findPatientByName(name)).toMatchObject({ referred_by_doctor_id: doctor.id })
  await guards.assertClean()
})

// ---- PA-12: Update Patient ---------------------------------------------------------------------

async function openEdit(page: Page, factory: E2EFactory) {
  const patient = await factory.createPatient({ notes: factory.uniqueName('notes before') })
  const notes = factory.uniqueName('notes after')
  await page.goto(`/patients/${patient.id}/edit`)
  const form = new PatientForm(page)
  await expect(page.locator('input#name')).toHaveValue(patient.name)
  await page.getByLabel('Notes', { exact: true }).fill(notes)
  return { patient, notes, form }
}

test('PA-12 a patient update lost to a dropped connection keeps the edit and saves once on retry', async ({ page, factory }) => {
  const guards = guardsFor(page, 'rest/v1/patients')
  const { patient, notes, form } = await openEdit(page, factory)

  const fault = await failNextSupabaseCall(page, { resource: 'rest/v1/patients', method: 'PATCH', mode: 'abort' })
  await form.submitButton().tap()
  await expectButtonRecovers(form.submitButton(), { idleName: 'Update Patient', message: NETWORK_ERROR_MESSAGE, fault })
  await expect(page.getByText(/TypeError|Failed to fetch/)).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}/edit$`))
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(notes)
  expect((await factory.findPatientByName(patient.name))?.notes).toBe(patient.notes)

  await fault.dispose()
  await form.submitButton().tap()
  await expect(page).toHaveURL(/\/patients$/)
  await expect.poll(async () => (await factory.findPatientByName(patient.name))?.notes).toBe(notes)
  await guards.assertClean()
})

test('PA-12 a patient update refused by the server shows the reason, keeps the edit and saves once on retry', async ({ page, factory }) => {
  const guards = guardsFor(page, 'rest/v1/patients')
  const { patient, notes, form } = await openEdit(page, factory)

  const fault = await failNextSupabaseCall(page, { resource: 'rest/v1/patients', method: 'PATCH', mode: 'http-400' })
  await form.submitButton().tap()
  await expectButtonRecovers(form.submitButton(), { idleName: 'Update Patient', message: INJECTED_SUPABASE_ERROR_MESSAGE, fault })
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(notes)
  expect((await factory.findPatientByName(patient.name))?.notes).toBe(patient.notes)

  await fault.dispose()
  await form.submitButton().tap()
  await expect(page).toHaveURL(/\/patients$/)
  await expect.poll(async () => (await factory.findPatientByName(patient.name))?.notes).toBe(notes)
  await guards.assertClean()
})

test('PA-12 a held patient update shows Saving…, sends nothing twice and saves once when released', async ({ page, factory }) => {
  const guards = guardsFor(page, 'rest/v1/patients')
  const { patient, notes, form } = await openEdit(page, factory)
  const updates = countRequests(page, { resource: 'rest/v1/patients', method: 'PATCH' })

  const hold = await holdNextSupabaseCall(page, { resource: 'rest/v1/patients', method: 'PATCH' })
  await form.submitButton().tap()
  await hold.whenHeld()
  await expect(form.submitButton()).toHaveAccessibleName('Saving…')
  await expect(form.submitButton()).toBeDisabled()
  await form.submitButton().click({ force: true })
  await page.locator('input#name').press('Enter')
  expect(hold.count()).toBe(1)

  await hold.release()
  await expect(page).toHaveURL(/\/patients$/)
  await expect.poll(async () => (await factory.findPatientByName(patient.name))?.notes).toBe(notes)
  expect(updates()).toBe(1)
  await guards.assertClean()
})

// ---- PA-13: the record is gone ----------------------------------------------------------------

// G-3: the update matches zero rows and Supabase reports no error; the form must not say "Patient
// updated" for a patient that no longer exists.
test('PA-13 updating a patient deleted meanwhile shows an error instead of "Patient updated"', async ({ page, factory }) => {
  const guards = guardsFor(page, 'rest/v1/patients')
  const { patient, form } = await openEdit(page, factory)
  await factory.deletePatientHard(patient.id)

  const updated = page.waitForResponse((response) => isSupabaseRequest(response.request(), { resource: 'rest/v1/patients', method: 'PATCH' }))
  await form.submitButton().tap()
  await updated
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}/edit$`))
  await expectFailureMessage(page, /no longer exists|not found|deleted|Error/i)
  await expect(page.getByText('Patient updated', { exact: true })).toHaveCount(0)
  await form.expectSubmitReady('Update Patient')
  await guards.assertClean()
})

// ---- PA-14: Add Plan --------------------------------------------------------------------------

async function openPlan(page: Page, factory: E2EFactory) {
  const patient = await factory.createPatient()
  const diagnosis = factory.uniqueName('plan diagnosis')
  const goals = factory.uniqueName('plan goals')
  await page.goto(`/patients/${patient.id}`)
  const form = new TreatmentPlanForm(page)
  await form.open()
  await form.fill({ diagnosis, goals })
  return { patient, diagnosis, goals, form }
}

async function expectPlanKept(form: TreatmentPlanForm, diagnosis: string, goals: string) {
  await expect(form.dialog).toBeVisible()
  await expect(form.field('diagnosis')).toHaveValue(diagnosis)
  await expect(form.field('goals')).toHaveValue(goals)
}

test('PA-14 a plan insert lost to a dropped connection says "Plan not saved", keeps the dialog and saves once on retry', async ({ page, factory }) => {
  const guards = guardsFor(page, 'rest/v1/treatment_plans')
  const { patient, diagnosis, goals, form } = await openPlan(page, factory)

  const fault = await failNextSupabaseCall(page, { resource: 'rest/v1/treatment_plans', method: 'POST', mode: 'abort' })
  await form.submitButton().tap()
  await expectButtonRecovers(form.submitButton(), { idleName: 'Create Plan', message: NETWORK_ERROR_MESSAGE, fault })
  await expectFailureMessage(page, 'Plan not saved')
  await expectPlanKept(form, diagnosis, goals)
  expect(await factory.findTreatmentPlans(patient.id)).toEqual([])

  await fault.dispose()
  await form.submitButton().tap()
  await expect(form.dialog).toBeHidden()
  await expect.poll(async () => (await factory.findTreatmentPlans(patient.id)).map((plan) => plan.diagnosis)).toEqual([diagnosis])
  await guards.assertClean()
})

test('PA-14 a plan insert refused by the server says "Plan not saved", keeps the dialog and saves once on retry', async ({ page, factory }) => {
  const guards = guardsFor(page, 'rest/v1/treatment_plans')
  const { patient, diagnosis, goals, form } = await openPlan(page, factory)

  const fault = await failNextSupabaseCall(page, { resource: 'rest/v1/treatment_plans', method: 'POST', mode: 'http-400' })
  await form.submitButton().tap()
  await expectButtonRecovers(form.submitButton(), { idleName: 'Create Plan', message: INJECTED_SUPABASE_ERROR_MESSAGE, fault })
  await expectFailureMessage(page, 'Plan not saved')
  await expectPlanKept(form, diagnosis, goals)
  expect(await factory.findTreatmentPlans(patient.id)).toEqual([])

  await fault.dispose()
  await form.submitButton().tap()
  await expect(form.dialog).toBeHidden()
  await expect.poll(async () => (await factory.findTreatmentPlans(patient.id)).map((plan) => plan.diagnosis)).toEqual([diagnosis])
  await guards.assertClean()
})

test('PA-14 a held plan insert shows Saving…, sends nothing twice and saves once when released', async ({ page, factory }) => {
  const guards = guardsFor(page, 'rest/v1/treatment_plans')
  const { patient, diagnosis, form } = await openPlan(page, factory)
  const inserts = countRequests(page, { resource: 'rest/v1/treatment_plans', method: 'POST' })

  const hold = await holdNextSupabaseCall(page, { resource: 'rest/v1/treatment_plans', method: 'POST' })
  await form.submitButton().tap()
  await hold.whenHeld()
  await expect(form.submitButton()).toHaveAccessibleName('Saving…')
  await expect(form.submitButton()).toBeDisabled()
  await form.submitButton().click({ force: true })
  await form.field('diagnosis').press('Enter')
  expect(hold.count()).toBe(1)
  expect(await factory.findTreatmentPlans(patient.id)).toEqual([])

  await hold.release()
  await expect(form.dialog).toBeHidden()
  await expect.poll(async () => (await factory.findTreatmentPlans(patient.id)).map((plan) => plan.diagnosis)).toEqual([diagnosis])
  expect(inserts()).toBe(1)
  await guards.assertClean()
})

// ---- PA-15: list reads ------------------------------------------------------------------------

test('PA-15 Load more and search recover from a dropped connection', async ({ page, factory }) => {
  const guards = guardsFor(page, 'rest/v1/patients')
  // More than one page (50) of patients, so Load more is offered.
  await factory.createPatients(52, (index) => ({ name: `E2E ${factory.token} AAA load-more ${String(index).padStart(3, '0')}` }))
  const target = await factory.createPatient({ name: `E2E ${factory.token} ZZZ search target` })

  await page.goto('/patients')
  const count = page.getByTestId('patient-list-count')
  await expect(count).toContainText('showing 50')
  const loadMore = page.getByRole('button', { name: /^(Load more \(\d+ remaining\)|Loading…)$/ })

  const loadFault = await failNextSupabaseCall(page, { resource: 'rest/v1/patients', method: 'GET', mode: 'abort' })
  await loadMore.tap()
  await expectButtonRecovers(loadMore, { idleName: /^Load more \(\d+ remaining\)$/, message: NETWORK_ERROR_MESSAGE, fault: loadFault })
  await expectFailureMessage(page, "Couldn't load more patients")
  await expect(count).toContainText('showing 50')
  await loadFault.dispose()
  await loadMore.tap()
  await expect(count).not.toContainText('showing 50')

  // Search: the failure text replaces the results and the spinner stops.
  const search = page.getByPlaceholder('Search by name or phone…')
  const searchFault = await failNextSupabaseCall(page, { resource: 'rest/v1/patients', method: 'GET', mode: 'abort' })
  await search.fill(target.name)
  await expect.poll(() => searchFault.hit()).toBe(true)
  await expect(page.getByText('Search could not be completed. Check your connection and try again.', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByLabel('Searching', { exact: true })).toHaveCount(0)
  await searchFault.dispose()
  // Typing again retries.
  await search.fill(`${target.name} `)
  await expect(page.getByRole('link', { name: new RegExp(target.name) }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText('Search could not be completed', { exact: false }).filter({ visible: true })).toHaveCount(0)
  await guards.assertClean()
})
