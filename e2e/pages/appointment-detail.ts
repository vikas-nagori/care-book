import { expect, type Locator, type Page } from '@playwright/test'

import { AppointmentForm } from './appointment-form'
import { SessionNoteForm } from './session-note-form'

export type AppointmentStatusLabel = 'Scheduled' | 'Completed' | 'Cancelled'

/** `/schedule/[id]`: status select, Edit, Adjust fee, session notes and Delete. */
export class AppointmentDetail {
  constructor(private readonly page: Page) {}

  async goto(appointmentId: string): Promise<void> {
    await this.page.goto(`/schedule/${appointmentId}`)
    await expect(this.page.getByText('Status:', { exact: true })).toBeVisible()
  }

  /** The status select on the summary card (it has no label; it is the only combobox showing a status). */
  statusSelect(current?: AppointmentStatusLabel): Locator {
    return this.page.getByRole('combobox').filter({ hasText: current ?? /^(Scheduled|Completed|Cancelled)$/ })
  }

  /** Pick a status; does not wait for the outcome. */
  async chooseStatus(from: AppointmentStatusLabel, to: AppointmentStatusLabel): Promise<void> {
    await this.statusSelect(from).click()
    await this.page.getByRole('option', { name: to, exact: true }).click()
  }

  async setStatus(from: AppointmentStatusLabel, to: AppointmentStatusLabel): Promise<void> {
    await this.chooseStatus(from, to)
    await expect(this.page.getByText('Status updated', { exact: true }).filter({ visible: true }).first()).toBeVisible()
    await expect(this.statusSelect(to)).toBeVisible()
  }

  deleteTrigger(): Locator {
    return this.page.getByRole('button', { name: /^(Delete|Deleting…)$/ }).filter({ visible: true }).first()
  }

  deleteConfirmation(): Locator {
    return this.page.getByRole('alertdialog', { name: 'Delete appointment?' })
  }

  /** Opens the confirmation and returns its confirm button (which keeps matching while pending). */
  async openDelete(): Promise<Locator> {
    await this.page.getByRole('button', { name: 'Delete', exact: true }).click()
    const confirmation = this.deleteConfirmation()
    await expect(confirmation).toBeVisible()
    return confirmation.getByRole('button', { name: /^(Delete|Deleting…)$/ })
  }

  async delete(): Promise<void> {
    const confirm = await this.openDelete()
    await confirm.click()
    await expect(this.page).toHaveURL(/\/schedule$/)
  }

  editDialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Edit Appointment' })
  }

  async openEdit(defaultTypeName = ''): Promise<AppointmentForm> {
    await this.page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(this.editDialog()).toBeVisible()
    return new AppointmentForm(this.page, defaultTypeName, this.editDialog())
  }

  feeDialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Adjust completed appointment fee' })
  }

  async openAdjustFee(): Promise<{ dialog: Locator; fee: Locator; reason: Locator; save: Locator }> {
    await this.page.getByRole('button', { name: 'Adjust fee', exact: true }).click()
    const dialog = this.feeDialog()
    await expect(dialog).toBeVisible()
    return {
      dialog,
      fee: dialog.getByLabel('Adjusted fee *', { exact: true }),
      reason: dialog.getByLabel('Reason *', { exact: true }),
      save: dialog.getByRole('button', { name: /^(Save fee adjustment|Saving…)$/ }),
    }
  }

  async adjustFee(fee: number, reason: string): Promise<void> {
    const { dialog, fee: feeInput, reason: reasonInput, save } = await this.openAdjustFee()
    await feeInput.fill(String(fee))
    await reasonInput.fill(reason)
    await save.click()
    await expect(this.page.getByText('Fee adjustment saved', { exact: true }).filter({ visible: true }).first()).toBeVisible()
    await expect(dialog).toBeHidden()
  }

  notesDialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Session Notes (SOAP)' })
  }

  async openNotes(): Promise<SessionNoteForm> {
    await this.page.getByRole('button', { name: /^(Add|Edit) Notes$/ }).click()
    await expect(this.notesDialog()).toBeVisible()
    return new SessionNoteForm(this.page)
  }

  /** The "Session Notes" card under the actions, present only when a note exists. */
  notesCard(): Locator {
    // A Card (`div.rounded-xl.border`) whose title reads exactly "Session Notes".
    return this.page.locator('div.rounded-xl.border').filter({
      has: this.page.getByText('Session Notes', { exact: true }),
    })
  }
}
