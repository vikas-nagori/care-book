import { test, expect } from '../support/factories'
import { adminClient } from '../support/supabase-admin'
import { CLINIC_A } from '../support/accounts'
import { clinicDate } from '../support/clinic-date'
import { attachErrorGuards } from '../support/assertions'

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
    await dialog.getByLabel('Search patients').fill(patient.name as string)
    await dialog.getByLabel('Patient', { exact: true }).selectOption(patient.id)
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
