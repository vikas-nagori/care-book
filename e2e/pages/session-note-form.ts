import { expect, type Locator, type Page } from '@playwright/test'

/** Every SOAP field is optional; an all-blank note is a legal save. */
export type SessionNoteFormData = {
  subjective?: string
  objective?: string
  assessment?: string
  plan?: string
  exercises?: string
}

const LABELS: Record<keyof SessionNoteFormData, string> = {
  subjective: 'Subjective',
  objective: 'Objective',
  assessment: 'Assessment',
  plan: 'Plan',
  exercises: 'Exercises Prescribed',
}

export class SessionNoteForm {
  constructor(private readonly page: Page) {}

  dialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Session Notes (SOAP)' })
  }

  field(name: keyof SessionNoteFormData): Locator {
    return this.dialog().getByLabel(LABELS[name], { exact: true })
  }

  /** Keeps matching while the save is pending. */
  saveButton(): Locator {
    return this.dialog().getByRole('button', { name: /^(Save Notes|Saving…)$/ })
  }

  async fill(data: SessionNoteFormData): Promise<void> {
    for (const key of Object.keys(LABELS) as (keyof SessionNoteFormData)[]) {
      const value = data[key]
      if (value !== undefined) await this.field(key).fill(value)
    }
  }

  /** Empty every SOAP field. */
  async clearAll(): Promise<void> {
    for (const key of Object.keys(LABELS) as (keyof SessionNoteFormData)[]) {
      await this.field(key).fill('')
      await expect(this.field(key)).toHaveValue('')
    }
  }

  async save(expectedToast: 'Notes saved' | 'Notes updated'): Promise<void> {
    await this.dialog().getByRole('button', { name: 'Save Notes', exact: true }).click()
    await expect(this.page.getByText(expectedToast, { exact: true })).toBeVisible()
    await expect(this.dialog()).toBeHidden()
  }
}
