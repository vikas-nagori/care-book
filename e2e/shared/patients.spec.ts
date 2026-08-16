import { PatientForm, type PatientFormData } from '../pages/patient-form'
import { attachErrorGuards } from '../support/assertions'
import { test, expect, type E2EFactory } from '../support/factories'

function stableDigits(value: string): string {
  let hash = 0
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return String(hash).padStart(9, '0').slice(-9)
}

function patientData(factory: E2EFactory, kind: string): PatientFormData {
  const unique = factory.uniqueName(kind)
  return {
    name: unique,
    phone: `9${stableDigits(unique)}`,
    email: `${factory.token}-${kind.replace(/[^a-z0-9]/gi, '-').toLowerCase()}@carebook.test`,
    dob: '1992-04-18',
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
    dob: data.dob,
    gender: 'female',
    address: data.address,
    medical_history: data.medicalHistory,
    notes: data.notes,
    referral_source: 'walk_in',
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
  updated.dob = '1991-05-15'
  updated.gender = 'Other'
  updated.referralSource = 'Other'

  await page.goto(`/patients/${original.id}/edit`)
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
  await expect(page.getByText('15 May 1991', { exact: true })).toBeVisible()
  await expect(page.getByText('Other', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText(updated.medicalHistory, { exact: true })).toBeVisible()
  await expect(page.getByText(updated.notes, { exact: true })).toBeVisible()

  const persisted = await factory.findPatientByName(updated.name)
  expect(persisted).toMatchObject({
    id: original.id,
    phone: updated.phone,
    email: updated.email,
    dob: updated.dob,
    gender: 'other',
    address: updated.address,
    medical_history: updated.medicalHistory,
    notes: updated.notes,
    referral_source: 'other',
  })
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
  await guards.assertClean()
})
