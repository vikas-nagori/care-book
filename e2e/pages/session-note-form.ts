import { expect, type Page } from '@playwright/test'

/** Every SOAP field is optional; an all-blank note is a legal save. */
export type SessionNoteFormData = {
  subjective?: string
  objective?: string
  assessment?: string
  plan?: string
  exercises?: string
}

export class SessionNoteForm {
  constructor(private readonly page: Page) {}

  private dialog() {
    return this.page.getByRole('dialog', { name: 'Session Notes (SOAP)' })
  }

  async fill(data: SessionNoteFormData): Promise<void> {
    const dialog = this.dialog()
    if (data.subjective !== undefined) await dialog.getByLabel('Subjective', { exact: true }).fill(data.subjective)
    if (data.objective !== undefined) await dialog.getByLabel('Objective', { exact: true }).fill(data.objective)
    if (data.assessment !== undefined) await dialog.getByLabel('Assessment', { exact: true }).fill(data.assessment)
    if (data.plan !== undefined) await dialog.getByLabel('Plan', { exact: true }).fill(data.plan)
    if (data.exercises !== undefined) await dialog.getByLabel('Exercises Prescribed', { exact: true }).fill(data.exercises)
  }

  async save(expectedToast: 'Notes saved' | 'Notes updated'): Promise<void> {
    await this.dialog().getByRole('button', { name: 'Save Notes', exact: true }).click()
    await expect(this.page.getByText(expectedToast, { exact: true })).toBeVisible()
    await expect(this.dialog()).toBeHidden()
  }
}
