import { expect, type Page } from '@playwright/test'

/**
 * Only `name` is required by the form. Every other field is filled only when given, so a spec
 * can save a patient exactly as sparse as a user may (and then prove every screen copes).
 */
export type PatientFormData = {
  name: string
  phone?: string
  email?: string
  /** Whole years, as typed into the Age field. */
  age?: string
  gender?: 'Male' | 'Female' | 'Other'
  referralSource?: 'Walk-in' | 'Google page' | 'Referred by existing patient' | 'Other'
  /** Typed source for an "Other" referral. */
  referralOther?: string
  /** Name of the existing patient picked for "Referred by existing patient". */
  referrerPatientName?: string
  address?: string
  medicalHistory?: string
  notes?: string
}

export class PatientForm {
  constructor(private readonly page: Page) {}

  private async chooseNamed(label: string, option: string): Promise<void> {
    await this.page.getByLabel(label, { exact: true }).click()
    await this.page.getByRole('option', { name: option, exact: true }).click()
  }

  private async chooseGender(option: NonNullable<PatientFormData['gender']>): Promise<void> {
    await this.page.getByLabel('Gender', { exact: true }).click()
    await this.page.getByRole('option', { name: option, exact: true }).click()
  }

  async fill(data: PatientFormData): Promise<void> {
    await this.page.getByLabel('Name *', { exact: true }).fill(data.name)
    if (data.phone !== undefined) await this.page.getByLabel('Phone', { exact: true }).fill(data.phone)
    if (data.email !== undefined) await this.page.getByLabel('Email', { exact: true }).fill(data.email)
    if (data.age !== undefined) await this.page.getByLabel('Age (years)', { exact: true }).fill(data.age)
    if (data.gender !== undefined) await this.chooseGender(data.gender)
    if (data.referralSource !== undefined) await this.chooseNamed('How were they referred?', data.referralSource)
    if (data.referrerPatientName !== undefined) await this.chooseReferrerPatient(data.referrerPatientName)
    if (data.referralOther !== undefined) await this.page.getByLabel('Please specify', { exact: true }).fill(data.referralOther)
    if (data.address !== undefined) await this.page.getByLabel('Address', { exact: true }).fill(data.address)
    if (data.medicalHistory !== undefined) await this.page.getByLabel('Medical History', { exact: true }).fill(data.medicalHistory)
    if (data.notes !== undefined) await this.page.getByLabel('Notes', { exact: true }).fill(data.notes)
  }

  private async chooseReferrerPatient(name: string): Promise<void> {
    await this.page.getByLabel('Referring Patient', { exact: true }).click()
    await this.page.getByPlaceholder('Search patient name…', { exact: true }).fill(name)
    // Options carry the phone as a hint, so match the name as a prefix.
    await this.page.getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).click()
  }

  async submitCreate(): Promise<void> {
    await this.page.getByRole('button', { name: 'Add Patient', exact: true }).click()
    await expect(this.page).toHaveURL(/\/patients$/)
  }

  async submitUpdate(): Promise<void> {
    await this.page.getByRole('button', { name: 'Update Patient', exact: true }).click()
    await expect(this.page).toHaveURL(/\/patients$/)
  }

  /** Submit expecting the Age field to be refused: the form stays put and says why. */
  async submitCreateExpectingAgeError(): Promise<void> {
    await this.page.getByRole('button', { name: 'Add Patient', exact: true }).click()
    await expect(this.page.getByRole('alert').filter({ hasText: 'Age must be a whole number between 0 and 120.' })).toBeVisible()
    await expect(this.page.getByLabel('Age (years)', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(this.page).toHaveURL(/\/patients\/new$/)
  }

  async expectDuplicateWarning(existingPatientName: string): Promise<void> {
    const dialog = this.page.getByRole('alertdialog', { name: 'Patient may already exist' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(existingPatientName)
    await expect(dialog.getByText('Add this patient anyway?', { exact: false })).toBeVisible()
  }

  async cancelDuplicate(): Promise<void> {
    await this.page.getByRole('alertdialog', { name: 'Patient may already exist' })
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
  }
}
