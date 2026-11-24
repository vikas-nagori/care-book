import { format, parseISO } from 'date-fns'
import type { Page } from '@playwright/test'
import { test, expect } from '../support/factories'
import { adminClient } from '../support/supabase-admin'
import { CLINIC_A } from '../support/accounts'
import { clinicDate } from '../support/clinic-date'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { isMobileProject } from '../support/mobile'

test('manages inquiry and patient reminders without changing appointments', async ({ page, factory }, testInfo) => {
  const guards = attachErrorGuards(page)
  const title = factory.uniqueName('reminder')
  const inquiryName = factory.uniqueName('inquiry-contact')
  const patient = await factory.createPatient()
  const date = clinicDate(150)
  const movedDate = clinicDate(165)
  const db = adminClient()
  const reminderRows = async () => {
    const { data, error } = await db.from('reminders').select('*').eq('clinic_id', CLINIC_A.id).eq('title', title)
    if (error) throw error
    return data ?? []
  }
  try {
    await page.goto(`/schedule?date=${date}`)
    const add = page.getByRole('button', { name: 'Add reminder', exact: true }).filter({ visible: true })
    await expect(add).toBeVisible()
    await expect(page.getByRole('button', { name: /New Appointment/i }).filter({ visible: true })).toBeVisible()
    await add.click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('What needs following up?').fill(title)
    await dialog.getByLabel('Name · Optional').fill(inquiryName)
    if (testInfo.project.name === 'admin-mobile') {
      await page.screenshot({ path: testInfo.outputPath('add-reminder-mobile.png') })
    }
    await dialog.getByRole('button', { name: 'Save reminder', exact: true }).click()
    await expect(dialog).toBeHidden()
    const card = page.getByRole('button').filter({ hasText: title })
    await expect(card).toBeVisible()
    await expect.poll(async () => (await reminderRows()).length).toBe(1)
    const inquiry = (await reminderRows())[0]
    expect(inquiry.patient_id).toBeNull()
    const { count, error } = await db.from('patients').select('id', { count: 'exact', head: true }).eq('name', inquiryName)
    expect(error).toBeNull()
    expect(count).toBe(0)
    if (testInfo.project.name === 'admin-mobile') {
      await page.screenshot({ path: testInfo.outputPath('calendar-reminder-mobile.png') })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
      expect(overflow).toBe(false)
    }
    await card.click()
    await dialog.getByRole('button', { name: 'Mark complete' }).click()
    await expect(card).toContainText('Completed')
    await card.click()
    await dialog.getByRole('button', { name: 'Reopen reminder' }).click()
    await expect(card).not.toContainText('Completed')
    await card.click()
    await dialog.getByRole('button', { name: 'Edit or reschedule' }).click()
    await dialog.getByRole('button', { name: 'Existing patient', exact: true }).click()
    await dialog.getByLabel('Patient', { exact: true }).click()
    await dialog.getByPlaceholder('Search patients…').fill(patient.name as string)
    await dialog.getByRole('button', { name: patient.name as string, exact: true }).click()
    await expect(dialog.getByLabel('Patient', { exact: true })).toContainText(patient.name as string)
    await dialog.getByLabel('Date', { exact: true }).fill(movedDate)
    await dialog.getByRole('button', { name: 'Save reminder', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(card).toHaveCount(0)
    await page.goto(`/schedule?date=${movedDate}`)
    await expect(card).toBeVisible()
    expect((await reminderRows())[0]).toMatchObject({ date: movedDate, patient_id: patient.id })
    await card.click()
    await dialog.getByRole('button', { name: 'Delete reminder' }).click()
    await dialog.getByRole('button', { name: 'Keep reminder' }).click()
    expect(await reminderRows()).toHaveLength(1)
    await dialog.getByRole('button', { name: 'Delete reminder' }).click()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(card).toHaveCount(0)
    await expect(page.getByText('No reminders for this day.')).toBeVisible()
    await guards.assertClean()
  } finally {
    const { error } = await db.from('reminders').delete().eq('clinic_id', CLINIC_A.id).eq('title', title)
    if (error) throw error
  }
})

test('keeps pending reminders on today\'s schedule until they are completed or deleted', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const todayTitle = factory.uniqueName('today-reminder')
  const overdueTitle = factory.uniqueName('overdue-reminder')
  const db = adminClient()
  const { error: insertError } = await db.from('reminders').insert([
    { clinic_id: CLINIC_A.id, title: todayTitle, date: clinicDate(0) },
    { clinic_id: CLINIC_A.id, title: overdueTitle, date: clinicDate(-1), time: '10:30' },
  ])
  expect(insertError).toBeNull()
  try {
    await page.goto('/')
    const section = page.getByRole('region', { name: "Today's reminders" })
    const todayCard = section.getByRole('button').filter({ hasText: todayTitle })
    const overdueCard = section.getByRole('button').filter({ hasText: overdueTitle })
    await expect(todayCard).toBeVisible()
    await expect(overdueCard).toBeVisible()
    await expect(overdueCard).toContainText('Overdue')
    await expect(todayCard).not.toContainText('Overdue')

    const dialog = page.getByRole('dialog')
    await todayCard.click()
    await dialog.getByRole('button', { name: 'Mark complete' }).click()
    await expect(dialog).toBeHidden()
    await expect(todayCard).toHaveCount(0)
    await expect(overdueCard).toBeVisible()

    await overdueCard.click()
    await dialog.getByRole('button', { name: 'Delete reminder' }).click()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(overdueCard).toHaveCount(0)
    // Only this test's reminders: the seed keeps a pending reminder dated today (SEED.reminderSparse).
    await expect(section.getByRole('button').filter({ hasText: factory.token })).toHaveCount(0)
    await expect(section.getByRole('status')).toContainText('Reminder deleted.')
    await guards.assertClean()
  } finally {
    const { error } = await db.from('reminders').delete().eq('clinic_id', CLINIC_A.id).in('title', [todayTitle, overdueTitle])
    if (error) throw error
  }
})

function reminderCard(page: Page, title: string) {
  return page.getByRole('button').filter({ hasText: title })
}

// S-22: every optional reminder field filled, then emptied again.
test('a reminder\'s time, phone, notes and patient can be added and then cleared back to nothing', async ({ page, factory }, testInfo) => {
  const guards = attachErrorGuards(page, { expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }] })
  const patient = await factory.createPatient()
  const title = factory.uniqueName('full-reminder')
  const phone = factory.uniqueMobile()
  const notes = factory.uniqueName('reminder-notes')
  const today = clinicDate()
  factory.watchUiReminder(title)

  await page.goto(`/schedule?date=${today}`)
  await page.getByRole('button', { name: 'Add reminder', exact: true }).filter({ visible: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Existing patient', exact: true }).click()
  await dialog.getByLabel('Patient', { exact: true }).click()
  await dialog.getByPlaceholder('Search patients…').fill(patient.name as string)
  await dialog.getByRole('button', { name: patient.name as string, exact: true }).click()
  await dialog.getByLabel('What needs following up?').fill(title)
  await dialog.getByLabel('Time · Optional').fill('16:20')
  await dialog.getByText('Add phone or notes', { exact: true }).click()
  await dialog.getByLabel('Phone · Optional').fill(phone)
  await dialog.getByLabel('Notes · Optional').fill(notes)
  await dialog.getByRole('button', { name: 'Save reminder', exact: true }).click()
  await expect(dialog).toBeHidden()

  const card = reminderCard(page, title)
  await expect(card).toContainText(`4:20 PM · ${patient.name} · Patient`)
  await card.click()
  await expect(dialog).toContainText(`${patient.name} · Existing patient`)
  await expect(dialog).toContainText(`${format(parseISO(today), 'd MMM yyyy')} · 4:20 PM`)
  await expect(dialog).toContainText(`Phone: ${phone}`)
  await expect(dialog).toContainText(notes)

  await dialog.getByRole('button', { name: 'Edit or reschedule', exact: true }).click()
  await dialog.getByLabel('Time · Optional').fill('')
  await dialog.getByLabel('Phone · Optional').fill('')
  await dialog.getByLabel('Notes · Optional').fill('')
  await dialog.getByRole('button', { name: 'Name only', exact: true }).click()
  await expect(dialog.getByLabel('Name · Optional')).toHaveValue('')
  await dialog.getByRole('button', { name: 'Save reminder', exact: true }).click()
  await expect(dialog).toBeHidden()

  await expect.poll(async () => (await factory.findReminders({ title }))[0]?.time ?? null).toBeNull()
  expect((await factory.findReminders({ title }))[0]).toMatchObject({
    time: null, phone: null, notes: null, patient_id: null, contact_name: null, status: 'pending',
  })

  // Day list, dialog, week view (desktop) and the dashboard all show placeholders, not NULLs.
  await expect(card).toContainText('Any time')
  await expect(card).not.toContainText(patient.name as string)
  await expectNoLeakedNulls(page)
  await card.click()
  await expect(dialog).toContainText('No name added')
  await expect(dialog).toContainText(`${format(parseISO(today), 'd MMM yyyy')} · Any time`)
  await expect(dialog).not.toContainText('Phone:')
  await expectNoLeakedNulls(page, { scope: dialog })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  if (!isMobileProject(testInfo)) {
    await page.getByRole('button', { name: 'Week', exact: true }).click()
    await expect(reminderCard(page, title).filter({ visible: true })).toBeVisible()
    await expectNoLeakedNulls(page)
  }

  await page.goto('/')
  const dashboardCard = page.getByRole('region', { name: "Today's reminders" }).getByRole('button').filter({ hasText: title })
  await expect(dashboardCard).toContainText('Any time')
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

// S-23: what the reminder form refuses, and a reminder that outlives its patient.
test('a reminder needs a title and, in patient mode, a patient; nothing is saved without them', async ({ page, factory }) => {
  const guards = attachErrorGuards(page, { expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }] })
  const date = clinicDate(146)
  const title = factory.uniqueName('no-patient-reminder')
  factory.watchUiReminder(title)
  await page.goto(`/schedule?date=${date}`)
  await page.getByRole('button', { name: 'Add reminder', exact: true }).filter({ visible: true }).click()
  const dialog = page.getByRole('dialog')
  const titleInput = dialog.getByLabel('What needs following up?')
  const save = dialog.getByRole('button', { name: 'Save reminder', exact: true })

  // Blank: the browser's required check stops it at the title.
  await save.click()
  await expect(titleInput).toBeFocused()
  expect(await titleInput.evaluate((input: HTMLInputElement) => input.validationMessage)).not.toBe('')
  // Spaces get past the browser; the form names the problem.
  await titleInput.fill('   ')
  await save.click()
  await expect(dialog.getByRole('alert')).toHaveText('Enter what needs following up.')

  await titleInput.fill(title)
  await dialog.getByRole('button', { name: 'Existing patient', exact: true }).click()
  await save.click()
  await expect(dialog.getByRole('alert')).toHaveText('Choose a patient, or switch to name only.')
  await expect(save).toBeEnabled()
  await expect(dialog).toBeVisible()
  expect(await factory.findReminders({ title })).toEqual([])
  await guards.assertClean()
})

test('a reminder whose patient was deleted still renders everywhere', async ({ page, factory }) => {
  const guards = attachErrorGuards(page, { expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }] })
  const patient = await factory.createPatient()
  const today = clinicDate()
  const reminder = await factory.createReminder({ date: today, patient_id: patient.id, time: '17:15' })
  await factory.deletePatientHard(patient.id)
  expect((await factory.findReminders({ title: reminder.title }))[0].patient_id).toBeNull()

  await page.goto(`/schedule?date=${today}`)
  const card = reminderCard(page, reminder.title)
  await expect(card).toContainText('5:15 PM')
  await expectNoLeakedNulls(page)
  await card.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('No name added')
  await expectNoLeakedNulls(page, { scope: dialog })
  await page.keyboard.press('Escape')

  await page.goto('/')
  await expect(page.getByRole('region', { name: "Today's reminders" }).getByRole('button').filter({ hasText: reminder.title })).toBeVisible()
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})
