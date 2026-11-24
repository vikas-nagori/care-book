import { expect, type Locator, type Page } from '@playwright/test'

/**
 * The "New Treatment Plan" dialog on the patient's Plans tab. Its labels have no `htmlFor`, so
 * every input is driven by its `name=`. Only `diagnosis` is required; Start Date defaults to today
 * and the rest are filled only when given.
 */
export type TreatmentPlanFormData = {
  diagnosis: string
  goals?: string
  /** yyyy-mm-dd; the form defaults it to today. */
  startDate?: string
  /** yyyy-mm-dd. */
  expectedEndDate?: string
}

export class TreatmentPlanForm {
  readonly dialog: Locator

  constructor(private readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'New Treatment Plan' })
  }

  /** Open the Plans tab and the "Add Plan" dialog on a patient detail page already loaded. */
  async open(): Promise<void> {
    const tab = this.page.getByRole('tab', { name: 'Plans', exact: true })
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await this.page.getByRole('button', { name: 'Add Plan', exact: true }).click()
    await expect(this.dialog).toBeVisible()
  }

  field(name: 'diagnosis' | 'goals' | 'start_date' | 'expected_end_date'): Locator {
    return this.dialog.locator(`[name="${name}"]`)
  }

  async fill(data: TreatmentPlanFormData): Promise<void> {
    await this.field('diagnosis').fill(data.diagnosis)
    if (data.goals !== undefined) await this.field('goals').fill(data.goals)
    if (data.startDate !== undefined) await this.field('start_date').fill(data.startDate)
    if (data.expectedEndDate !== undefined) await this.field('expected_end_date').fill(data.expectedEndDate)
  }

  /** "Create Plan", or "Saving…" while the insert is in flight. */
  submitButton(): Locator {
    return this.dialog.getByRole('button', { name: /^(Create Plan|Saving…)$/ })
  }

  /** Submit and wait for the dialog to close (the plan was saved). */
  async submit(): Promise<void> {
    await this.submitButton().click()
    await expect(this.dialog).toBeHidden()
  }
}
