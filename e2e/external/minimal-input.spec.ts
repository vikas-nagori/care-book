// Minimal-input coverage for the External Staff workspace (plan 5.5, X-1, X-2, X-3, X-14).
//
// External Staff see a thin projection of a patient (name, phone, email, age, gender, address)
// and book with every field required. What can be blank is the patient behind the booking, so
// these cases render name-only and admin-cleared patients on every External Staff screen, and
// render the External Staff booking on every clinic screen that can show it.

import type { Locator, Page, TestInfo } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

import { PatientForm } from '../pages/patient-form'
import { ExternalBookingDialog, escapeRegExp, press, scheduleChip, signInWithMobile } from '../pages/external-dialogs'
import { ADMIN, CLINIC_A, EXTERNAL, EXTERNAL_EMPTY, PASSWORD, STAFF } from '../support/accounts'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect, type E2EFactory } from '../support/factories'
import { SEED, SPARSE_NAMES } from '../support/ids'
import { isMobileProject } from '../support/mobile'
import { adminClient } from '../support/supabase-admin'

function guardsFor(page: Page) {
  // reportClientError's telemetry budget can answer 429 when the matrix runs back to back.
  return attachErrorGuards(page, { expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }] })
}

function formatTime12(time: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`
}

/** External Staff bookings for one patient and slot (external_profile_id is set on every one). */
async function externalBookings(patientId: string, date: string, time: string) {
  const { data, error } = await adminClient().from('appointments')
    .select('id, status, notes, external_profile_id, assigned_to, external_staff_id')
    .eq('patient_id', patientId).eq('date', date).eq('time', time)
    .not('external_profile_id', 'is', null)
  expect(error).toBeNull()
  return data ?? []
}

/** Bookings this spec makes on a fixed SEED patient are removed by slot, also after a crash. */
async function removeSlot(patientId: string, date: string, time: string) {
  const { error } = await adminClient().from('appointments').delete()
    .eq('patient_id', patientId).eq('date', date).eq('time', time).not('external_profile_id', 'is', null)
  expect(error).toBeNull()
}

/** One of the five profile fields External Staff see (Phone, Email, Age, Gender, Address). */
type ProfileField = 'Phone' | 'Email' | 'Age' | 'Gender' | 'Address'

function profileValue(dialog: Locator, label: ProfileField) {
  return dialog.locator('dl > div').filter({ has: dialog.page().locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd')
}

async function openSharedPatient(page: Page, testInfo: TestInfo, name: string, search: string) {
  await page.getByRole('textbox', { name: 'Search patients' }).fill(search)
  const row = page.getByRole('button', { name: new RegExp(escapeRegExp(name)) }).filter({ visible: true })
  await expect(row).toHaveCount(1)
  await expectNoLeakedNulls(page)
  await press(row, testInfo)
  const profile = page.getByRole('dialog', { name, exact: true })
  await expect(profile).toBeVisible()
  return profile
}

test('a name-only shared patient renders with placeholders on every External Staff screen, before and after booking', async ({ page, factory }, testInfo) => {
  const mobile = isMobileProject(testInfo)
  const name = SPARSE_NAMES.patientExternal
  const date = clinicDate(mobile ? 9 : 8)
  const time = mobile ? '19:40' : '19:10'
  const type = await factory.findAppointmentType(true)
  await removeSlot(SEED.patientExternalSparse, date, time)
  const guards = guardsFor(page)
  try {
    await page.goto('/external/patients')
    await expect(page.getByRole('heading', { name: 'Patients', exact: true })).toBeVisible()
    const profile = await openSharedPatient(page, testInfo, name, 'Sparse External')
    // Five blanks, five placeholders, and nothing to call or write to.
    await expect(profile.locator('dd')).toHaveText(['—', '—', '—', '—', '—'])
    await expect(profile.locator('a[href^="tel:"], a[href^="mailto:"]')).toHaveCount(0)
    await expectNoLeakedNulls(page, { scope: profile })

    await press(profile.getByRole('button', { name: 'Book appointment', exact: true }), testInfo)
    const booking = new ExternalBookingDialog(page)
    await expect(booking.dialog).toBeVisible()
    await expect(booking.patient).toHaveValue(SEED.patientExternalSparse)
    await expectNoLeakedNulls(page, { scope: booking.dialog })
    await booking.fill({ typeId: type.id, date, time })
    await press(booking.submit, testInfo)
    await expect(booking.dialog).toBeHidden()

    await expect(page).toHaveURL(new RegExp(`/external\\?date=${date}$`))
    await expect(page.getByText('Appointment booked', { exact: true }).filter({ visible: true })).toBeVisible()
    const booked = await externalBookings(SEED.patientExternalSparse, date, time)
    expect(booked).toHaveLength(1)
    factory.trackAppointment(booked[0].id)
    expect(booked[0].notes).toBeNull()

    // Day view.
    const chip = scheduleChip(page, name).filter({ hasText: formatTime12(time) })
    await expect(chip).toBeVisible()
    await expectNoLeakedNulls(page)
    await press(chip, testInfo)
    const opened = page.getByRole('dialog', { name, exact: true })
    await expect(opened).toBeVisible()
    await expectNoLeakedNulls(page, { scope: opened })
    await page.keyboard.press('Escape')
    await expect(opened).toBeHidden()

    // Week view exists on desktop only; the phone layout has no Week toggle.
    const week = page.getByRole('button', { name: 'Week', exact: true })
    if (mobile) {
      await expect(week).toHaveCount(0)
    } else {
      await week.click()
      await expect(page.getByRole('button', { name: `${formatTime12(time)} Sparse`, exact: true })).toBeVisible()
      await expectNoLeakedNulls(page)
    }
    await guards.assertClean()
  } finally {
    await removeSlot(SEED.patientExternalSparse, date, time)
  }
})

test('an External Staff booking renders for the admin with its External Staff label and stays hidden from clinic staff', async ({ page, browser, factory }, testInfo) => {
  const mobile = isMobileProject(testInfo)
  const external = await factory.findProfileByEmail(EXTERNAL.email)
  const patient = await factory.createPatient({ phone: null })
  await factory.shareWithExternal(patient.id, [external.id])
  const type = await factory.findAppointmentType(true)
  // Today, so the dashboard's "Today's schedule" can show it.
  const date = clinicDate()
  const time = mobile ? '20:40' : '20:10'

  const guards = guardsFor(page)
  await page.goto(`/external?date=${date}`)
  const booking = await ExternalBookingDialog.open(page, testInfo)
  await expectNoLeakedNulls(page, { scope: booking.dialog })
  await booking.fill({ patientId: patient.id, typeId: type.id, time })
  await press(booking.submit, testInfo)
  await expect(booking.dialog).toBeHidden()
  await expect(page.getByText('Appointment booked', { exact: true }).filter({ visible: true })).toBeVisible()
  const booked = await externalBookings(patient.id, date, time)
  expect(booked).toHaveLength(1)
  const id = booked[0].id
  factory.trackAppointment(id)
  expect(booked[0]).toMatchObject({ external_profile_id: external.id, assigned_to: null, external_staff_id: null, notes: null })
  await expect(scheduleChip(page, patient.name)).toBeVisible()
  await expectNoLeakedNulls(page)
  await guards.assertClean()

  const toDetail = (target: Page) => target.locator(`a[href="/schedule/${id}"]`).filter({ visible: true })
  const adminContext = await browser.newContext({ storageState: ADMIN.storageState })
  const staffContext = await browser.newContext({ storageState: STAFF.storageState })
  try {
    const admin = await adminContext.newPage()
    const adminGuards = guardsFor(admin)
    await admin.goto(`/schedule?date=${date}`)
    await expect(toDetail(admin)).toBeVisible()
    await expect(toDetail(admin)).toHaveAttribute('title', /· External Staff$/)
    await expect(toDetail(admin)).toContainText(patient.name)
    await expectNoLeakedNulls(admin)
    if (!mobile) {
      await admin.getByRole('button', { name: 'Week', exact: true }).click()
      await expect(toDetail(admin)).toContainText('External Staff')
      await expectNoLeakedNulls(admin)
    }

    await admin.goto(`/schedule/${id}`)
    await expect(admin.getByRole('link', { name: patient.name, exact: true }).filter({ visible: true }).first()).toBeVisible()
    await expect(admin.getByText('External Staff', { exact: true }).filter({ visible: true }).first()).toBeVisible()
    await expectNoLeakedNulls(admin)

    await admin.goto('/')
    await expect(toDetail(admin).first()).toBeVisible()
    await expect(toDetail(admin).first()).toContainText(patient.name)
    await expectNoLeakedNulls(admin)

    await admin.goto(`/patients/${patient.id}`)
    await admin.getByRole('tab', { name: 'Appts', exact: true }).click()
    await expect(admin.getByRole('tabpanel').getByText(`at ${formatTime12(time)}`, { exact: false })).toBeVisible()
    await expectNoLeakedNulls(admin)
    await admin.getByRole('tab', { name: 'Billing', exact: true }).click()
    await expect(admin.getByRole('tab', { name: 'Billing', exact: true })).toHaveAttribute('data-state', 'active')
    await expectNoLeakedNulls(admin)

    await admin.goto('/billing')
    await expect(admin.getByRole('heading', { name: 'Billing', exact: true }).filter({ visible: true }).first()).toBeVisible()
    await admin.waitForLoadState('networkidle')
    await expectNoLeakedNulls(admin)
    await adminGuards.assertClean()

    // Clinic staff never see another clinician's External Staff booking.
    const staff = await staffContext.newPage()
    const staffGuards = guardsFor(staff)
    await staff.goto(`/schedule?date=${date}`)
    await expect(staff.getByRole('heading', { name: 'Schedule', exact: true }).filter({ visible: true }).first()).toBeVisible()
    await staff.waitForLoadState('networkidle')
    await expect(staff.locator(`a[href="/schedule/${id}"]`)).toHaveCount(0)
    await expect(staff.getByText(patient.name, { exact: false })).toHaveCount(0)
    await expectNoLeakedNulls(staff)

    await staff.goto('/')
    await expect(staff.getByRole('heading', { name: "Today's schedule", exact: true })).toBeVisible()
    await expect(staff.locator(`a[href="/schedule/${id}"]`)).toHaveCount(0)
    await expect(staff.getByText(patient.name, { exact: false })).toHaveCount(0)
    await expectNoLeakedNulls(staff)

    await staff.goto(`/patients/${patient.id}`)
    await staff.getByRole('tab', { name: 'Appts', exact: true }).click()
    await expect(staff.getByRole('tabpanel').getByText('No appointments yet.', { exact: true })).toBeVisible()
    await expectNoLeakedNulls(staff)
    await staffGuards.assertClean()
  } finally {
    await adminContext.close()
    await staffContext.close()
  }
})

test('a shared patient whose phone, email and age the admin clears renders with placeholders for External Staff', async ({ page, browser, factory }, testInfo) => {
  const external = await factory.findProfileByEmail(EXTERNAL.email)
  const email = factory.uniqueEmail('shared-patient')
  const patient = await factory.createPatient({
    email, age_years: 42, age_recorded_on: clinicDate(), address: '12 Placeholder Road',
  })
  await factory.shareWithExternal(patient.id, [external.id])
  const search = patient.name.split(' ').slice(-3).join(' ')

  const guards = guardsFor(page)
  await page.goto('/external/patients')
  let profile = await openSharedPatient(page, testInfo, patient.name, search)
  await expect(profileValue(profile, 'Phone').getByRole('link', { name: patient.phone!, exact: true })).toHaveAttribute('href', `tel:${patient.phone}`)
  await expect(profileValue(profile, 'Email').getByRole('link', { name: email, exact: true })).toHaveAttribute('href', `mailto:${email}`)
  await expect(profileValue(profile, 'Age')).toHaveText('42 years')
  await expectNoLeakedNulls(page, { scope: profile })
  await page.keyboard.press('Escape')

  const adminContext = await browser.newContext({ storageState: ADMIN.storageState })
  try {
    const admin = await adminContext.newPage()
    const adminGuards = guardsFor(admin)
    await admin.goto(`/patients/${patient.id}/edit`)
    const form = new PatientForm(admin)
    await form.fill({ name: patient.name, phone: '', email: '', age: '' })
    await form.submitUpdate()
    await adminGuards.assertClean()
  } finally {
    await adminContext.close()
  }
  const { data: saved, error } = await adminClient().from('patients')
    .select('phone, email, age_years, age_recorded_on, dob, address').eq('id', patient.id).single()
  expect(error).toBeNull()
  expect(saved).toEqual({ phone: null, email: null, age_years: null, age_recorded_on: null, dob: null, address: '12 Placeholder Road' })

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Patients', exact: true })).toBeVisible()
  profile = await openSharedPatient(page, testInfo, patient.name, search)
  await expect(profileValue(profile, 'Phone')).toHaveText('—')
  await expect(profileValue(profile, 'Email')).toHaveText('—')
  await expect(profileValue(profile, 'Age')).toHaveText('—')
  await expect(profileValue(profile, 'Address')).toHaveText('12 Placeholder Road')
  await expect(profile.locator('a[href^="tel:"], a[href^="mailto:"]')).toHaveCount(0)
  await expectNoLeakedNulls(page, { scope: profile })
  await guards.assertClean()
})

/** A clinic of its own with no appointment types, one admin, one External Staff login and one shared patient. */
async function clinicWithoutTypes(factory: E2EFactory) {
  const clinic = await factory.createClinic()
  const clinicAdmin = await factory.createAuthUser({ clinicId: clinic.id, role: 'admin' })
  const external = await factory.createAuthUser({ clinicId: clinic.id, role: 'external_staff' })
  const patient = await factory.createPatient({ clinic_id: clinic.id, phone: null })
  // A new clinic is seeded with default types; take them away, the state this case is about.
  const { error: deleteError } = await adminClient().from('appointment_types').delete().eq('clinic_id', clinic.id)
  expect(deleteError).toBeNull()
  const { count, error: typesError } = await adminClient().from('appointment_types')
    .select('id', { count: 'exact', head: true }).eq('clinic_id', clinic.id)
  expect(typesError).toBeNull()
  expect(count).toBe(0)
  // Shared the way the clinic's admin shares (factory.shareWithExternal acts for Clinic A only).
  const actor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const login = await actor.auth.signInWithPassword({ email: clinicAdmin.email, password: PASSWORD })
  expect(login.error).toBeNull()
  try {
    const shared = await actor.rpc('replace_patient_external_access', { p_patient_id: patient.id, p_profile_ids: [external.id] })
    expect(shared.error).toBeNull()
  } finally {
    await actor.auth.signOut({ scope: 'local' })
  }
  return { clinic, external, patient }
}

test('an account with nothing shared shows its details, and a clinic with no appointment types asks for one', async ({ page, browser, factory }, testInfo) => {
  const emptyContext = await browser.newContext({ storageState: EXTERNAL_EMPTY.storageState })
  try {
    const empty = await emptyContext.newPage()
    const emptyGuards = guardsFor(empty)
    await empty.goto('/external/account')
    await expect(empty.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible()
    const details = empty.locator('dl')
    await expect(details.getByText(EXTERNAL_EMPTY.email, { exact: true })).toBeVisible()
    await expect(details.getByText('External Staff', { exact: true })).toBeVisible()
    await expect(details.getByText('Not added yet', { exact: true })).toHaveCount(0)
    await expect(empty.getByRole('button', { name: 'Change Password', exact: true })).toBeEnabled()
    await expect(empty.getByRole('button', { name: 'Logout', exact: true })).toBeVisible()
    await expectNoLeakedNulls(empty)

    await empty.goto('/external')
    await expect(empty.getByText('No patients have been shared', { exact: true })).toBeVisible()
    await expect(empty.getByRole('button', { name: 'New appointment', exact: true })).toBeDisabled()
    await expectNoLeakedNulls(empty)
    await emptyGuards.assertClean()
  } finally {
    await emptyContext.close()
  }

  const { clinic, external, patient } = await clinicWithoutTypes(factory)
  expect(clinic.id).not.toBe(CLINIC_A.id)
  const guards = guardsFor(page)
  await signInWithMobile(page, { mobileNumber: external.mobileNumber })
  await expect(page).toHaveURL(/\/external(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByText('Ask your clinic admin to set up an appointment type.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New appointment', exact: true })).toBeDisabled()
  await expectNoLeakedNulls(page)

  await page.goto('/external/patients')
  await expect(page.getByTestId('patient-list-count')).toHaveText('1 shared with you')
  const profile = await openSharedPatient(page, testInfo, patient.name, patient.name.split(' ').slice(-3).join(' '))
  await expect(profile.getByRole('button', { name: 'Book appointment', exact: true })).toBeDisabled()
  await expect(profile.getByText('Ask your clinic admin to set up an appointment type.', { exact: true })).toBeVisible()
  await expectNoLeakedNulls(page, { scope: profile })
  await guards.assertClean()
})
