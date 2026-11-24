// Admin-only patient controls when the server action fails (plan 5.1, PA-16 and PA-18).
//
// PA-16 Delete patient: the confirm is opened from separate desktop and mobile header buttons, so
// it runs on both admin projects (D2). PA-18 External Staff access: one control on every viewport,
// so phone only.

import type { Locator, Page, TestInfo } from '@playwright/test'
import { CLINIC_A } from '../support/accounts'
import { attachErrorGuards } from '../support/assertions'
import { test, expect, type E2EFactory } from '../support/factories'
import {
  ACTION_UNREACHABLE_MESSAGE,
  expectButtonRecovers,
  expectFailureMessage,
  expectedFaultConsoleErrors,
  failNextServerAction,
  holdNextServerAction,
  isServerActionRequest,
} from '../support/fault-injection'
import { isMobileProject } from '../support/mobile'
import { adminClient } from '../support/supabase-admin'

// Faults must reach Playwright's router, not the service worker.
test.use({ serviceWorkers: 'block' })

function guardsFor(page: Page) {
  return attachErrorGuards(page, {
    expectedFailures: expectedFaultConsoleErrors('server-action'),
    // reportClientError's telemetry budget can answer 429 when the matrix runs back to back.
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }],
  })
}

/** Tap on the phone projects (touch enabled), click on desktop. */
async function press(locator: Locator, testInfo: TestInfo) {
  if (isMobileProject(testInfo)) await locator.tap()
  else await locator.click()
}

/** Server actions the page sends from now on, counted outside any hold (which stops on release). */
function countServerActions(page: Page) {
  let count = 0
  page.on('request', (request) => { if (isServerActionRequest(request)) count += 1 })
  return () => count
}

// ---- PA-16: Delete patient --------------------------------------------------------------------

async function openDeleteConfirm(page: Page, testInfo: TestInfo, factory: E2EFactory) {
  const patient = await factory.createPatient()
  await page.goto(`/patients/${patient.id}`)
  // The header Delete button: the desktop header on desktop, the sticky mobile header on phones.
  const headerDelete = page.getByRole('button', { name: 'Delete', exact: true }).filter({ visible: true })
  await expect(headerDelete).toHaveCount(1)
  await press(headerDelete, testInfo)
  const dialog = page.getByRole('alertdialog', { name: 'Delete this patient?' })
  await expect(dialog).toBeVisible()
  const input = page.getByTestId('confirm-delete-patient-input')
  await input.fill(patient.name)
  const confirm = dialog.getByRole('button', { name: /^(Delete|Deleting…)$/ })
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
  await expect(confirm).toBeEnabled()
  return { patient, dialog, input, confirm, cancel }
}

async function expectDeleteRecovered(input: { dialog: Locator; confirm: Locator; cancel: Locator; field: Locator; name: string }) {
  await expect(input.dialog).toBeVisible()
  await expect(input.cancel).toBeEnabled()
  await expect(input.field).toBeEnabled()
  await expect(input.field).toHaveValue(input.name)
}

test('PA-16 a delete lost to a dropped connection keeps the patient and the dialog usable, and the retry deletes', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const { patient, dialog, input, confirm, cancel } = await openDeleteConfirm(page, testInfo, factory)

  const fault = await failNextServerAction(page, 'abort')
  await press(confirm, testInfo)
  await expectButtonRecovers(confirm, { idleName: 'Delete', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expectFailureMessage(page, 'Delete failed')
  await expectDeleteRecovered({ dialog, confirm, cancel, field: input, name: patient.name })
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}$`))
  expect(await factory.findPatientByName(patient.name)).not.toBeNull()

  await fault.dispose()
  await press(confirm, testInfo)
  await expect(page).toHaveURL(/\/patients$/)
  await expect.poll(async () => factory.findPatientByName(patient.name)).toBeNull()
  await guards.assertClean()
})

test('PA-16 a delete answered with a server error keeps the patient and the dialog usable, and the retry deletes', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const { patient, dialog, input, confirm, cancel } = await openDeleteConfirm(page, testInfo, factory)

  const fault = await failNextServerAction(page, 'http-500')
  await press(confirm, testInfo)
  await expectButtonRecovers(confirm, { idleName: 'Delete', message: ACTION_UNREACHABLE_MESSAGE, fault })
  await expectFailureMessage(page, 'Delete failed')
  await expectDeleteRecovered({ dialog, confirm, cancel, field: input, name: patient.name })
  expect(await factory.findPatientByName(patient.name)).not.toBeNull()

  await fault.dispose()
  await press(confirm, testInfo)
  await expect(page).toHaveURL(/\/patients$/)
  await expect.poll(async () => factory.findPatientByName(patient.name)).toBeNull()
  await guards.assertClean()
})

test('PA-16 a held delete shows Deleting…, locks the dialog, sends one request and deletes once released', async ({ page, factory }, testInfo) => {
  const guards = guardsFor(page)
  const { patient, dialog, input, confirm, cancel } = await openDeleteConfirm(page, testInfo, factory)
  const actions = countServerActions(page)

  const hold = await holdNextServerAction(page)
  await press(confirm, testInfo)
  await hold.whenHeld()
  await expect(confirm).toHaveAccessibleName('Deleting…')
  await expect(confirm).toBeDisabled()
  await expect(cancel).toBeDisabled()
  await expect(input).toBeDisabled()
  // Neither a second click nor Escape gets through while the delete is in flight.
  await confirm.click({ force: true })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  expect(hold.count()).toBe(1)
  expect(await factory.findPatientByName(patient.name)).not.toBeNull()

  await hold.release()
  await expect(page).toHaveURL(/\/patients$/)
  await expect.poll(async () => factory.findPatientByName(patient.name)).toBeNull()
  expect(actions()).toBe(1)
  await guards.assertClean()
})

// ---- PA-18: External Staff access -------------------------------------------------------------

async function grantedProfileIds(patientId: string): Promise<string[]> {
  const { data, error } = await adminClient()
    .from('patient_external_access').select('external_profile_id').eq('patient_id', patientId).order('external_profile_id')
  if (error) throw new Error(`read grants: ${error.message}`)
  return (data ?? []).map((row) => row.external_profile_id as string)
}

/** The checkbox row for one External Staff account in the patient's access card. */
function accessCheckbox(page: Page, fullName: string) {
  return page.locator('label').filter({ hasText: fullName }).getByRole('checkbox')
}

test.describe('External Staff access (phone only)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'one control on every viewport (D2): runs on the phone project')
  })

  test('PA-18 Save access recovers from a dropped connection, a held request and a deactivated account', async ({ page, factory }) => {
    const guards = guardsFor(page)
    const patient = await factory.createPatient()
    const first = await factory.createAuthUser({ clinicId: CLINIC_A.id, role: 'external_staff' })
    const second = await factory.createAuthUser({ clinicId: CLINIC_A.id, role: 'external_staff' })
    const firstName = first.profile.full_name!
    const secondName = second.profile.full_name!

    await page.goto(`/patients/${patient.id}`)
    const card = page.locator('form').filter({ has: page.getByText('Share patient with External Staff') })
    const save = card.getByRole('button', { name: /^(Save access|Saving…)$/ })
    await card.getByLabel('Search External Staff').fill(factory.token)
    await accessCheckbox(page, firstName).tap()
    await expect(save).toBeEnabled()

    // Dropped connection: message, button back, selection kept, nothing granted; the retry saves.
    const fault = await failNextServerAction(page, 'abort')
    await save.tap()
    await expectButtonRecovers(save, { idleName: 'Save access', message: ACTION_UNREACHABLE_MESSAGE, fault })
    await expect(accessCheckbox(page, firstName)).toBeChecked()
    expect(await grantedProfileIds(patient.id)).toEqual([])
    await fault.dispose()
    await save.tap()
    await expect(card.getByRole('status').filter({ hasText: 'Access saved.' })).toBeVisible()
    await expect.poll(() => grantedProfileIds(patient.id)).toEqual([first.id])

    // Held: Saving…, the whole fieldset locked, one request, saved once released.
    const actions = countServerActions(page)
    await accessCheckbox(page, secondName).tap()
    const hold = await holdNextServerAction(page)
    await save.tap()
    await hold.whenHeld()
    await expect(save).toHaveAccessibleName('Saving…')
    await expect(save).toBeDisabled()
    await expect(accessCheckbox(page, firstName)).toBeDisabled()
    await save.click({ force: true })
    expect(hold.count()).toBe(1)
    await hold.release()
    await expect(card.getByRole('status').filter({ hasText: 'Access saved.' })).toBeVisible()
    await expect.poll(() => grantedProfileIds(patient.id)).toEqual([first.id, second.id].sort())
    expect(actions()).toBe(1)

    // An account deactivated after the page loaded: the server refuses it with a clear message,
    // the selection stays as picked and the stored grants do not change.
    const third = await factory.createAuthUser({ clinicId: CLINIC_A.id, role: 'external_staff' })
    const thirdName = third.profile.full_name!
    await page.reload()
    await card.getByLabel('Search External Staff').fill(factory.token)
    await accessCheckbox(page, thirdName).tap()
    const { error } = await adminClient().from('profiles').update({ status: 'blocked' }).eq('id', third.id)
    expect(error).toBeNull()
    await save.tap()
    await expect(card.getByRole('alert')).toHaveText('Choose active External Staff from this clinic.')
    await expect(save).toBeEnabled()
    await expect(save).toHaveAccessibleName('Save access')
    await expect(accessCheckbox(page, thirdName)).toBeChecked()
    await expect(accessCheckbox(page, firstName)).toBeChecked()
    expect(await grantedProfileIds(patient.id)).toEqual([first.id, second.id].sort())
    await guards.assertClean()
  })
})
