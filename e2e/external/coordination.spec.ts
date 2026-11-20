import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { ADMIN, EXTERNAL, EXTERNAL_EMPTY, PASSWORD, STAFF } from '../support/accounts'
import { clinicDate } from '../support/clinic-date'
import { SEED } from '../support/ids'
import { adminClient } from '../support/supabase-admin'
import { gotoNotFoundRoute } from '../support/assertions'

test('external calendar and patient profile expose only explicitly shared coordination details', async ({ page }) => {
  await page.goto(`/external?date=${clinicDate()}`)
  await expect(page.getByRole('link', { name: 'My Calendar', exact: true })).toBeVisible()
  await expect(page.getByText('Leela Shared Patient', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Asha Rao', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Ravi Kumar', { exact: true })).toHaveCount(0)

  await page.getByRole('link', { name: 'Shared Patients', exact: true }).click()
  await expect(page.getByText('Leela Shared Patient', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('leela@example.test', { exact: true })).toBeVisible()
  await expect(page.getByText('10 Example Lane', { exact: true })).toBeVisible()
  await expect(page.getByText('9876500010', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('PRIVATE_')
  await expect(page.getByRole('link', { name: 'Billing', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0)
  await page.screenshot({ path: `test-results/external-profile-${test.info().project.name}.png`, fullPage: true })
})

test('external accounts cannot open internal clinic routes', async ({ page }) => {
  for (const path of ['/', '/patients', `/patients/${SEED.patientExternal}`, `/schedule/${SEED.appointmentExternal}`, '/billing', '/settings']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/external(?:[?#]|$)/)
    await expect(page.locator('body')).not.toContainText('PRIVATE_')
  }
})

test('an external account with no grants starts empty', async ({ browser }) => {
  const context = await browser.newContext({ storageState: EXTERNAL_EMPTY.storageState })
  try {
    const page = await context.newPage()
    await page.goto('/external')
    await expect(page.getByText('No patients have been shared', { exact: false })).toBeVisible()
    await expect(page.getByText('Leela Shared Patient', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New appointment', exact: true })).toBeDisabled()
  } finally {
    await context.close()
  }
})

test('admin can see the external appointment while internal staff cannot open it', async ({ browser }) => {
  const adminContext = await browser.newContext({ storageState: ADMIN.storageState })
  const staffContext = await browser.newContext({ storageState: STAFF.storageState })
  try {
    const admin = await adminContext.newPage()
    await admin.goto(`/schedule/${SEED.appointmentExternal}`)
    await expect(admin.getByRole('link', { name: 'Leela Shared Patient', exact: true })).toBeVisible()
    const staff = await staffContext.newPage()
    await gotoNotFoundRoute(staff, `/schedule/${SEED.appointmentExternal}`)
    await expect(staff.locator('body')).not.toContainText('Leela Shared Patient')
  } finally {
    await adminContext.close()
    await staffContext.close()
  }
})

test('external booking permits hidden overlaps and appears in the admin calendar', async ({ page, browser }) => {
  const db = adminClient()
  const time = test.info().project.name.includes('mobile') ? '13:32' : '13:31'
  const date = clinicDate()
  const slot = () => db.from('appointments').delete().eq('patient_id', SEED.patientExternal).eq('date', date).eq('time', time)
  const cleared = await slot()
  expect(cleared.error).toBeNull()
  const { data: fixture, error: fixtureError } = await db.from('appointments')
    .select('clinic_id, appointment_type_id').eq('id', SEED.appointmentExternal).single()
  expect(fixtureError).toBeNull()
  const hiddenId = randomUUID()
  const hidden = await db.from('appointments').insert({
    id: hiddenId,
    clinic_id: fixture!.clinic_id,
    patient_id: SEED.patientExternal,
    appointment_type_id: fixture!.appointment_type_id,
    date, time, duration_minutes: 45, type: 'Clinic', status: 'scheduled',
    fee: 800, notes: 'PRIVATE_HIDDEN_OVERLAP_SENTINEL',
  })
  expect(hidden.error).toBeNull()
  const adminContext = await browser.newContext({ storageState: ADMIN.storageState })
  try {
    await page.goto(`/external?date=${date}`)
    await page.getByRole('button', { name: 'New appointment', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New appointment', exact: true })
    await dialog.getByLabel('Patient', { exact: true }).selectOption(SEED.patientExternal)
    await dialog.getByLabel('Appointment type', { exact: true }).selectOption(fixture!.appointment_type_id)
    await dialog.getByLabel('Date', { exact: true }).fill(date)
    await dialog.getByLabel('Time', { exact: true }).fill(time)
    await dialog.getByLabel('Duration (minutes)', { exact: true }).fill('45')
    await dialog.getByRole('button', { name: 'Book appointment', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    const saved = await db.from('appointments').select('id, external_profile_id')
      .eq('patient_id', SEED.patientExternal).eq('date', date).eq('time', time).not('external_profile_id', 'is', null).single()
    expect(saved.error).toBeNull()
    expect(saved.data?.external_profile_id).toBeTruthy()
    await expect(page.locator('body')).not.toContainText('PRIVATE_')

    const admin = await adminContext.newPage()
    await admin.goto(`/schedule/${saved.data!.id}`)
    await expect(admin.getByRole('link', { name: 'Leela Shared Patient', exact: true })).toBeVisible()
    const rows = await db.from('appointments').select('id').eq('patient_id', SEED.patientExternal).eq('date', date).eq('time', time)
    expect(rows.data).toHaveLength(2)
  } finally {
    await adminContext.close()
    const cleanup = await slot()
    expect(cleanup.error).toBeNull()
  }
})

test('admin multi-select shares patient basics with a second external account and revocation removes access', async ({ browser }) => {
  const db = adminClient()
  const { data: originalProfile, error } = await db.from('profiles').select('id').eq('email', EXTERNAL.email).single()
  expect(error).toBeNull()
  const adminContext = await browser.newContext({ storageState: ADMIN.storageState })
  const externalContext = await browser.newContext({ storageState: EXTERNAL_EMPTY.storageState })
  const actor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    const admin = await adminContext.newPage()
    await admin.goto(`/patients/${SEED.patientExternal}`)
    const second = admin.getByRole('checkbox', { name: new RegExp(EXTERNAL_EMPTY.email) })
    await second.check()
    await admin.getByRole('button', { name: 'Save access', exact: true }).click()
    await expect(admin.getByText('Access saved.', { exact: true })).toBeVisible()

    const external = await externalContext.newPage()
    await external.goto('/external?tab=patients')
    await expect(external.getByText('Leela Shared Patient', { exact: true })).toBeVisible()
    await expect(external.getByText('leela@example.test', { exact: true })).toBeVisible()
    await external.getByRole('link', { name: 'My Calendar', exact: true }).click()
    await expect(external.getByText('Leela Shared Patient', { exact: true })).toHaveCount(0)

    await second.uncheck()
    await admin.getByRole('button', { name: 'Save access', exact: true }).click()
    await expect(admin.getByText('Access saved.', { exact: true })).toBeVisible()
    await external.goto('/external?tab=patients')
    await expect(external.getByText('No patients have been shared', { exact: false })).toBeVisible()
    await expect(external.getByText('Leela Shared Patient', { exact: true })).toHaveCount(0)
    await admin.screenshot({ path: `test-results/admin-patient-sharing-${test.info().project.name}.png`, fullPage: true })
  } finally {
    const login = await actor.auth.signInWithPassword({ email: ADMIN.email, password: PASSWORD })
    if (login.error) throw login.error
    const restore = await actor.rpc('replace_patient_external_access', {
      p_patient_id: SEED.patientExternal, p_profile_ids: [originalProfile!.id],
    })
    expect(restore.error).toBeNull()
    await actor.auth.signOut({ scope: 'local' })
    await adminContext.close()
    await externalContext.close()
  }
})
