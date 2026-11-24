import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { ADMIN, CLINIC_A, EXTERNAL, EXTERNAL_EMPTY, PASSWORD, STAFF } from '../support/accounts'
import { clinicDate, wholeYearsSince } from '../support/clinic-date'
import { SEED } from '../support/ids'
import { adminClient } from '../support/supabase-admin'
import { attachErrorGuards, expectNoLeakedNulls, gotoNotFoundRoute } from '../support/assertions'
import { test, expect } from '../support/factories'
import { EXTERNAL_OBSERVABILITY_REDIRECT_NOISE, ExternalAppointmentDialog, ExternalBookingDialog, escapeRegExp, press, scheduleChip } from '../pages/external-dialogs'

function guardsFor(page: Page, options: { allowCrashText?: readonly string[] } = {}) {
  // reportClientError's telemetry budget can answer 429 when the matrix runs back to back.
  return attachErrorGuards(page, {
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }],
    expectedFailures: EXTERNAL_OBSERVABILITY_REDIRECT_NOISE,
    ...options,
  })
}

test('external calendar and patient profile expose only explicitly shared coordination details', async ({ page }) => {
  const guards = guardsFor(page)
  await page.goto(`/external?date=${clinicDate()}`)
  // Same chrome as clinic staff: sidebar on desktop, bottom bar on mobile, with only their pages.
  const nav = (name: string) => page.getByRole('link', { name, exact: true }).filter({ visible: true })
  await expect(nav('Schedule')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText('Leela Shared Patient', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Asha Rao', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Ravi Kumar', { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-today="true"]').filter({ visible: true }).first()).toBeVisible()
  await expectNoLeakedNulls(page)

  await nav('Patients').click()
  await expect(page).toHaveURL(/\/external\/patients$/)
  await page.getByPlaceholder('Search by name or phone…').fill('Leela')
  await page.getByRole('button', { name: /Leela Shared Patient/ }).filter({ visible: true }).click()
  const profile = page.getByRole('dialog', { name: 'Leela Shared Patient', exact: true })
  await expect(profile.getByText('leela@example.test', { exact: true })).toBeVisible()
  await expect(profile.getByText('10 Example Lane', { exact: true })).toBeVisible()
  await expect(profile.getByText('9876500010', { exact: true })).toBeVisible()
  // The seeded date of birth reaches External Staff only as an age.
  await expect(profile.getByText(`${wholeYearsSince('1990-03-10')} years`, { exact: true })).toBeVisible()
  await expect(profile.getByText('Age', { exact: true })).toBeVisible()
  await expect(profile.getByText(/1990/)).toHaveCount(0)
  await expectNoLeakedNulls(page, { scope: profile })
  await expect(page.locator('body')).not.toContainText('PRIVATE_')
  await expect(page.getByRole('link', { name: 'Billing', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0)
  await page.screenshot({ path: `test-results/external-profile-${test.info().project.name}.png`, fullPage: true })
  await guards.assertClean()
})

test('old workspace tab links land on the new pages', async ({ page }) => {
  const guards = guardsFor(page)
  await page.goto('/external?tab=patients')
  await expect(page).toHaveURL(/\/external\/patients$/)
  await page.goto('/external?tab=account')
  await expect(page).toHaveURL(/\/external\/account$/)
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible()
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('external staff reschedule and then cancel their own upcoming appointment', async ({ page }) => {
  const db = adminClient()
  const { data: fixture, error: fixtureError } = await db.from('appointments')
    .select('appointment_type_id').eq('id', SEED.appointmentExternal).single()
  expect(fixtureError).toBeNull()
  const mobile = test.info().project.name.includes('mobile')
  const from = clinicDate(mobile ? 5 : 3), to = clinicDate(mobile ? 6 : 4)
  // Booked the way External Staff book: as themselves, through the booking function.
  const actor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const login = await actor.auth.signInWithPassword({ email: EXTERNAL.email, password: PASSWORD })
  expect(login.error).toBeNull()
  const booked = await actor.rpc('external_create_appointment', { p_request: {
    id: randomUUID(), patient_id: SEED.patientExternal, appointment_type_id: fixture!.appointment_type_id,
    date: from, time: '15:10', duration_minutes: 45,
  } })
  await actor.auth.signOut({ scope: 'local' })
  expect(booked.error).toBeNull()
  const id = (booked.data as { id: string }).id
  const guards = guardsFor(page)
  try {
    await page.goto(`/external?date=${from}`)
    await expect(page.getByRole('button', { name: /Leela Shared Patient/ }).filter({ visible: true }).first()).toBeVisible()
    await expectNoLeakedNulls(page)
    await page.getByRole('button', { name: /Leela Shared Patient/ }).filter({ visible: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Leela Shared Patient', exact: true })
    await expect(dialog).toBeVisible()
    await expectNoLeakedNulls(page, { scope: dialog })
    await dialog.getByLabel('Date', { exact: true }).fill(to)
    await dialog.getByLabel('Duration (minutes)', { exact: true }).fill('60')
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page).toHaveURL(new RegExp(`date=${to}`))
    const moved = await db.from('appointments').select('date, duration_minutes, status').eq('id', id).single()
    expect(moved.data).toMatchObject({ date: to, duration_minutes: 60, status: 'scheduled' })

    await page.getByRole('button', { name: /Leela Shared Patient/ }).filter({ visible: true }).first().click()
    await dialog.getByRole('button', { name: 'Cancel appointment', exact: true }).click()
    await dialog.getByRole('button', { name: 'Cancel appointment', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    const cancelled = await db.from('appointments').select('status').eq('id', id).single()
    expect(cancelled.data?.status).toBe('cancelled')
    await expect(page.locator('body')).not.toContainText('PRIVATE_')
    await expectNoLeakedNulls(page)
    await guards.assertClean()
  } finally {
    await db.from('appointments').delete().eq('id', id)
  }
})

test('external accounts cannot open internal clinic routes', async ({ page }) => {
  const guards = guardsFor(page)
  for (const path of ['/', '/patients', `/patients/${SEED.patientExternal}`, `/schedule/${SEED.appointmentExternal}`, '/billing', '/settings']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/external(?:[?#]|$)/)
    await expect(page.getByRole('heading', { name: 'Schedule', exact: true }).filter({ visible: true })).toBeVisible()
    await expect(page.locator('body')).not.toContainText('PRIVATE_')
    await expectNoLeakedNulls(page)
  }
  await guards.assertClean()
})

test('an external account with no grants starts empty', async ({ browser }) => {
  const context = await browser.newContext({ storageState: EXTERNAL_EMPTY.storageState })
  try {
    const page = await context.newPage()
    const guards = guardsFor(page)
    await page.goto('/external')
    await expect(page.getByText('No patients have been shared', { exact: false })).toBeVisible()
    await expect(page.getByText('Leela Shared Patient', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New appointment', exact: true })).toBeDisabled()
    await expectNoLeakedNulls(page)
    await guards.assertClean()
  } finally {
    await context.close()
  }
})

test('admin can see the external appointment while internal staff cannot open it', async ({ browser }) => {
  const adminContext = await browser.newContext({ storageState: ADMIN.storageState })
  const staffContext = await browser.newContext({ storageState: STAFF.storageState })
  try {
    const admin = await adminContext.newPage()
    const adminGuards = guardsFor(admin)
    await admin.goto(`/schedule/${SEED.appointmentExternal}`)
    await expect(admin.getByRole('link', { name: 'Leela Shared Patient', exact: true })).toBeVisible()
    await expectNoLeakedNulls(admin)
    await adminGuards.assertClean()
    const staff = await staffContext.newPage()
    // The not-found boundary is the expected outcome here, so its copy is not a crash.
    const staffGuards = guardsFor(staff, { allowCrashText: ['This page could not be found'] })
    await gotoNotFoundRoute(staff, `/schedule/${SEED.appointmentExternal}`)
    await expect(staff.locator('body')).not.toContainText('Leela Shared Patient')
    await expectNoLeakedNulls(staff)
    await staffGuards.assertClean()
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
  const guards = guardsFor(page)
  try {
    await page.goto(`/external?date=${date}`)
    await page.getByRole('button', { name: 'New appointment', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New appointment', exact: true })
    await expect(dialog).toBeVisible()
    await expectNoLeakedNulls(page, { scope: dialog })
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
    await expectNoLeakedNulls(page)
    await guards.assertClean()

    const admin = await adminContext.newPage()
    const adminGuards = guardsFor(admin)
    await admin.goto(`/schedule/${saved.data!.id}`)
    await expect(admin.getByRole('link', { name: 'Leela Shared Patient', exact: true })).toBeVisible()
    await expectNoLeakedNulls(admin)
    await adminGuards.assertClean()
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
    const adminGuards = guardsFor(admin)
    await admin.goto(`/patients/${SEED.patientExternal}`)
    await expect(admin.getByRole('button', { name: 'Save access', exact: true })).toBeVisible()
    await expectNoLeakedNulls(admin)
    const second = admin.getByRole('checkbox', { name: new RegExp(EXTERNAL_EMPTY.email) })
    await second.check()
    await admin.getByRole('button', { name: 'Save access', exact: true }).click()
    await expect(admin.getByText('Access saved.', { exact: true })).toBeVisible()

    const external = await externalContext.newPage()
    const externalGuards = guardsFor(external)
    await external.goto('/external/patients')
    await expect(external.getByRole('button', { name: /Leela Shared Patient/ }).filter({ visible: true })).toBeVisible()
    await expectNoLeakedNulls(external)
    await external.getByRole('button', { name: /Leela Shared Patient/ }).filter({ visible: true }).click()
    await expect(external.getByRole('dialog', { name: 'Leela Shared Patient' }).getByText('leela@example.test', { exact: true })).toBeVisible()
    await external.keyboard.press('Escape')
    await external.getByRole('link', { name: 'Schedule', exact: true }).filter({ visible: true }).click()
    await expect(external.getByText('Leela Shared Patient', { exact: true })).toHaveCount(0)

    await second.uncheck()
    await admin.getByRole('button', { name: 'Save access', exact: true }).click()
    await expect(admin.getByText('Access saved.', { exact: true })).toBeVisible()
    await external.goto('/external/patients')
    await expect(external.getByText('No patients have been shared', { exact: false })).toBeVisible()
    await expect(external.getByText('Leela Shared Patient', { exact: true })).toHaveCount(0)
    await admin.screenshot({ path: `test-results/admin-patient-sharing-${test.info().project.name}.png`, fullPage: true })
    await expectNoLeakedNulls(external)
    await adminGuards.assertClean()
    await externalGuards.assertClean()
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

test('booking from the patient dialog lands on that day, and a reschedule can change type and time or be backed out', async ({ page, factory }, testInfo) => {
  const external = await factory.findProfileByEmail(EXTERNAL.email)
  const patient = await factory.createPatient({ phone: null })
  await factory.shareWithExternal(patient.id, [external.id])
  const { data: types, error } = await adminClient().from('appointment_types')
    .select('id, name').eq('clinic_id', CLINIC_A.id).order('sort_order').order('name').limit(2)
  expect(error).toBeNull()
  expect(types, 'Clinic A needs two appointment types to change between').toHaveLength(2)
  const [first, second] = types!
  const date = clinicDate(10)
  const booked = () => adminClient().from('appointments')
    .select('id, date, time, duration_minutes, status, appointment_type_id').eq('patient_id', patient.id)
  const guards = guardsFor(page)

  await page.goto('/external/patients')
  await page.getByRole('textbox', { name: 'Search patients' }).fill(patient.name.split(' ').slice(-3).join(' '))
  await press(page.getByRole('button', { name: new RegExp(escapeRegExp(patient.name)) }).filter({ visible: true }), testInfo)
  const profile = page.getByRole('dialog', { name: patient.name, exact: true })
  await expect(profile).toBeVisible()
  await press(profile.getByRole('button', { name: 'Book appointment', exact: true }), testInfo)
  const booking = new ExternalBookingDialog(page)
  await expect(booking.dialog).toBeVisible()
  await expect(booking.patient).toHaveValue(patient.id)
  await expect(booking.date).toHaveValue(clinicDate())
  await booking.fill({ typeId: first.id, date, time: '10:30' })
  await press(booking.submit, testInfo)
  await expect(booking.dialog).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/external\\?date=${date}$`))
  await expect(page.getByText('Appointment booked', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(scheduleChip(page, patient.name).filter({ hasText: '10:30 AM' })).toBeVisible()
  await expectNoLeakedNulls(page)
  const { data: created } = await booked()
  expect(created).toEqual([expect.objectContaining({ date, time: '10:30:00', status: 'scheduled', appointment_type_id: first.id })])

  // Reschedule: another type and another time on the same day.
  let dialog = await ExternalAppointmentDialog.open(page, testInfo, patient.name)
  await expect(dialog.type).toHaveValue(first.id)
  await dialog.type.selectOption(second.id)
  await dialog.time.fill('11:45')
  await press(dialog.save, testInfo)
  await expect(dialog.dialog).toBeHidden()
  await expect(page.getByText('Appointment updated', { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(scheduleChip(page, patient.name).filter({ hasText: '11:45 AM' })).toBeVisible()
  await expect.poll(async () => (await booked()).data).toEqual([
    expect.objectContaining({ id: created![0].id, date, time: '11:45:00', status: 'scheduled', appointment_type_id: second.id }),
  ])

  // Start a cancellation, then keep the appointment.
  dialog = await ExternalAppointmentDialog.open(page, testInfo, patient.name)
  await press(dialog.startCancel, testInfo)
  await expect(dialog.dialog.getByText('Cancel this appointment? The clinic will see it as cancelled.', { exact: true })).toBeVisible()
  await press(dialog.keep, testInfo)
  await expect(dialog.save).toBeVisible()
  await expect(dialog.type).toHaveValue(second.id)
  await expectNoLeakedNulls(page, { scope: dialog.dialog })
  await page.keyboard.press('Escape')
  await expect(dialog.dialog).toBeHidden()
  expect((await booked()).data).toEqual([expect.objectContaining({ status: 'scheduled', time: '11:45:00' })])
  await guards.assertClean()
})
