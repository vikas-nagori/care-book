import { expect, type Page } from '@playwright/test'

export type PatientFormData = {
  name: string
  phone: string
  email: string
  dob: string
  gender: 'Male' | 'Female' | 'Other'
  referralSource: 'Walk-in' | 'Other'
  address: string
  medicalHistory: string
  notes: string
}

export class PatientForm {
  constructor(private readonly page: Page) {}

  private async chooseNamed(label: string, option: string): Promise<void> {
    await this.page.getByLabel(label, { exact: true }).click()
    await this.page.getByRole('option', { name: option, exact: true }).click()
  }

  private async chooseGender(option: PatientFormData['gender']): Promise<void> {
    // The Radix gender trigger currently has no accessible name; it is the form's only visible,
    // unnamed combobox. Keep this workaround in the POM rather than leaking it into every spec.
    await this.page.getByRole('combobox', { name: '', exact: true }).filter({ visible: true }).first().click()
    await this.page.getByRole('option', { name: option, exact: true }).click()
  }

  async fill(data: PatientFormData): Promise<void> {
    await this.page.getByLabel('Name *', { exact: true }).fill(data.name)
    await this.page.getByLabel('Phone', { exact: true }).fill(data.phone)
    await this.page.getByLabel('Email', { exact: true }).fill(data.email)
    await this.page.getByLabel('Date of Birth', { exact: true }).fill(data.dob)
    await this.chooseGender(data.gender)
    await this.chooseNamed('How were they referred?', data.referralSource)
    await this.page.getByLabel('Address', { exact: true }).fill(data.address)
    await this.page.getByLabel('Medical History', { exact: true }).fill(data.medicalHistory)
    await this.page.getByLabel('Notes', { exact: true }).fill(data.notes)
  }

  async submitCreate(): Promise<void> {
    await this.page.getByRole('button', { name: 'Add Patient', exact: true }).click()
    await expect(this.page).toHaveURL(/\/patients$/)
  }

  async submitUpdate(): Promise<void> {
    await this.page.getByRole('button', { name: 'Update Patient', exact: true }).click()
    await expect(this.page).toHaveURL(/\/patients$/)
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
