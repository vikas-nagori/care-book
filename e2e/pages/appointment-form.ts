import { expect, type Page } from '@playwright/test'

export type AppointmentFormData = {
  patientName: string
  date: string
  time: string
  durationMinutes: string
  notes: string
  appointmentTypeName?: string
  assignedStaffLabel?: string
}

export class AppointmentForm {
  constructor(
    private readonly page: Page,
    private readonly defaultAppointmentTypeName: string,
  ) {}

  async fill(data: AppointmentFormData): Promise<void> {
    const patientSearch = this.page.getByLabel('Patient *', { exact: true })
    await patientSearch.fill(data.patientName)
    await this.page.getByRole('button', { name: data.patientName, exact: true }).click()

    await this.page.getByLabel('Date *', { exact: true }).fill(data.date)
    await this.page.getByLabel('Time *', { exact: true }).fill(data.time)
    await this.page.getByLabel('Duration (min)', { exact: true }).fill(data.durationMinutes)
    await this.page.getByLabel('Notes', { exact: true }).fill(data.notes)

    // The type trigger currently has no accessible name; it remains the form's only visible,
    // unnamed combobox even when the private-type assignment field appears.
    const typeTrigger = this.page
      .getByRole('combobox', { name: '', exact: true })
      .filter({ visible: true })
      .first()
    await typeTrigger.click()
    await this.page.getByRole('option', {
      name: data.appointmentTypeName ?? this.defaultAppointmentTypeName,
      exact: true,
    }).click()

    if (data.assignedStaffLabel) {
      await this.page.getByLabel('Assigned Staff', { exact: true }).click()
      await this.page.getByRole('option', { name: data.assignedStaffLabel, exact: true }).click()
    }
  }

  async enableWeeklyRepeat(weekdayLabel: string, sessionCount: number): Promise<void> {
    const repeat = this.page.getByRole('switch', { name: 'Toggle repeat appointment' })
    await repeat.click()
    await expect(repeat).toHaveAttribute('aria-checked', 'true')

    const weekday = this.page.getByRole('button', { name: weekdayLabel, exact: true })
    if (await weekday.getAttribute('aria-pressed') !== 'true') await weekday.click()
    await this.page.getByLabel('Total sessions *', { exact: true }).fill(String(sessionCount))
    await expect(this.page.getByText(`${sessionCount} appointments`, { exact: true })).toBeVisible()
  }

  async submitAndExpectBooked(expectedCount = 1): Promise<void> {
    const name = expectedCount === 1 ? 'Book Appointment' : `Book ${expectedCount} appointments`
    await this.page.getByRole('button', { name, exact: true }).click()
    await expect(this.page).toHaveURL(/\/schedule(?:\?.*)?$/)
  }

  async submitAndExpectConflict(conflictDateText: string): Promise<void> {
    await this.page.getByRole('button', { name: /^Book \d+ appointments$/ }).click()
    const notifications = this.page.getByRole('region', { name: 'Notifications (F8)' })
    await expect(notifications.getByText('Appointment not booked', { exact: true })).toBeVisible()
    await expect(notifications).toContainText('This patient already has an appointment')
    await expect(notifications).toContainText(conflictDateText)
  }
}
