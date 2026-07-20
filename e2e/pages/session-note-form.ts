import { expect, type Page } from '@playwright/test'

export type SessionNoteFormData = {
  subjective: string
  objective: string
  assessment: string
  plan: string
  exercises: string
}

export class SessionNoteForm {
  constructor(private readonly page: Page) {}

  private dialog() {
    return this.page.getByRole('dialog', { name: 'Session Notes (SOAP)' })
  }

  async fill(data: SessionNoteFormData): Promise<void> {
    const dialog = this.dialog()
    await dialog.getByLabel('Subjective', { exact: true }).fill(data.subjective)
    await dialog.getByLabel('Objective', { exact: true }).fill(data.objective)
    await dialog.getByLabel('Assessment', { exact: true }).fill(data.assessment)
    await dialog.getByLabel('Plan', { exact: true }).fill(data.plan)
    await dialog.getByLabel('Exercises Prescribed', { exact: true }).fill(data.exercises)
  }

  async save(expectedToast: 'Notes saved' | 'Notes updated'): Promise<void> {
    await this.dialog().getByRole('button', { name: 'Save Notes', exact: true }).click()
    await expect(this.page.getByText(expectedToast, { exact: true })).toBeVisible()
    await expect(this.dialog()).toBeHidden()
  }
}
