import { expect, type Locator, type Page } from '@playwright/test'

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
  referralSource?: 'Walk-in' | 'Referred by doctor' | 'Google page' | 'Referred by existing patient' | 'Other'
  /** Typed source for an "Other" referral. */
  referralOther?: string
  /** Name of the existing patient picked for "Referred by existing patient". */
  referrerPatientName?: string
  /**
   * "Referred by doctor": the name typed into the doctor search, then the existing doctor whose
   * name matches it case-insensitively is picked. Use `newDoctor` to add one instead.
   */
  doctorName?: string
  /** "Referred by doctor": add a doctor that is not in the list. Specialty and address are optional. */
  newDoctor?: { name: string; specialty?: string; address?: string }
  address?: string
  medicalHistory?: string
  notes?: string
}

/** Free-text fields a user can empty on the edit form. */
export type ClearablePatientField = 'phone' | 'email' | 'age' | 'address' | 'medicalHistory' | 'notes'

const FIELD_LABELS: Record<ClearablePatientField, string> = {
  phone: 'Phone',
  email: 'Email',
  age: 'Age (years)',
  address: 'Address',
  medicalHistory: 'Medical History',
  notes: 'Notes',
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
    // By id: the "New Doctor" card has its own "Name *" field.
    await this.page.locator('input#name').fill(data.name)
    if (data.phone !== undefined) await this.page.getByLabel('Phone', { exact: true }).fill(data.phone)
    if (data.email !== undefined) await this.page.getByLabel('Email', { exact: true }).fill(data.email)
    if (data.age !== undefined) await this.page.getByLabel('Age (years)', { exact: true }).fill(data.age)
    if (data.gender !== undefined) await this.chooseGender(data.gender)
    if (data.referralSource !== undefined) await this.chooseNamed('How were they referred?', data.referralSource)
    if (data.referrerPatientName !== undefined) await this.chooseReferrerPatient(data.referrerPatientName)
    if (data.doctorName !== undefined) await this.chooseDoctor(data.doctorName)
    if (data.newDoctor !== undefined) await this.addDoctor(data.newDoctor)
    if (data.referralOther !== undefined) await this.page.getByLabel('Please specify', { exact: true }).fill(data.referralOther)
    if (data.address !== undefined) await this.page.getByLabel('Address', { exact: true }).fill(data.address)
    if (data.medicalHistory !== undefined) await this.page.getByLabel('Medical History', { exact: true }).fill(data.medicalHistory)
    if (data.notes !== undefined) await this.page.getByLabel('Notes', { exact: true }).fill(data.notes)
  }

  /** Empty one free-text field (the edit form prefills them). */
  async clear(field: ClearablePatientField): Promise<void> {
    const input = this.page.getByLabel(FIELD_LABELS[field], { exact: true })
    await input.fill('')
    await expect(input).toHaveValue('')
  }

  private async chooseReferrerPatient(name: string): Promise<void> {
    await this.page.getByLabel('Referring Patient', { exact: true }).click()
    await this.page.getByPlaceholder('Search patient name…', { exact: true }).fill(name)
    // Options carry the phone as a hint, so match the name as a prefix.
    await this.page.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}`) }).click()
  }

  /** The doctor search panel, opened from the "Referring Doctor" trigger. */
  private async searchDoctors(query: string): Promise<void> {
    await this.page.getByLabel('Referring Doctor', { exact: true }).click()
    await this.page.getByPlaceholder('Search doctor name…', { exact: true }).fill(query)
  }

  /** The "Add doctor “…”" option offered for a name that is not in the list yet. */
  addDoctorOption(name: string): Locator {
    return this.page.getByRole('button', { name: `Add doctor “${name.trim()}”`, exact: true })
  }

  /**
   * Type `query` into the doctor search and pick the existing doctor it names. The list matches
   * case-insensitively, so a differently cased query must find the stored doctor and must not
   * offer to add a second one.
   */
  async chooseDoctor(query: string): Promise<void> {
    await this.searchDoctors(query)
    await expect(this.addDoctorOption(query)).toHaveCount(0)
    // Options carry the specialty as a hint, so match the name as a case-insensitive prefix.
    await this.page.getByRole('button', { name: new RegExp(`^${escapeRegExp(query.trim())}`, 'i') }).click()
    await expect(this.page.getByLabel('Referring Doctor', { exact: true })).toHaveText(new RegExp(escapeRegExp(query.trim()), 'i'))
  }

  async addDoctor(doctor: NonNullable<PatientFormData['newDoctor']>): Promise<void> {
    await this.searchDoctors(doctor.name)
    await this.addDoctorOption(doctor.name).click()
    await expect(this.page.getByText('New Doctor', { exact: true })).toBeVisible()
    await expect(this.page.locator('input#new_doctor_name')).toHaveValue(doctor.name.trim())
    if (doctor.specialty !== undefined) await this.page.getByLabel('Specialty (optional)', { exact: true }).fill(doctor.specialty)
    if (doctor.address !== undefined) await this.page.getByLabel('Address (optional)', { exact: true }).fill(doctor.address)
  }

  /** The submit button in either label; it reads "Saving…" while a save is in flight. */
  submitButton(): Locator {
    return this.page.locator('form').getByRole('button', { name: /^(Add Patient|Update Patient|Saving…)$/ })
  }

  /** The submit button is idle, enabled and named `label`, ready for a tap. */
  async expectSubmitReady(label: 'Add Patient' | 'Update Patient'): Promise<void> {
    const button = this.submitButton()
    await expect(button).toBeVisible()
    await expect(button).toBeEnabled()
    await expect(button).toHaveAccessibleName(label)
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

  duplicateDialog(): Locator {
    return this.page.getByRole('alertdialog', { name: 'Patient may already exist' })
  }

  async expectDuplicateWarning(existingPatientName: string): Promise<void> {
    const dialog = this.duplicateDialog()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(existingPatientName)
    await expect(dialog.getByText('Add this patient anyway?', { exact: false })).toBeVisible()
  }

  async cancelDuplicate(): Promise<void> {
    await this.duplicateDialog().getByRole('button', { name: 'Cancel', exact: true }).click()
  }

  /** "Add anyway" on the duplicate-phone warning. The caller asserts where it lands. */
  async confirmDuplicate(): Promise<void> {
    await this.duplicateDialog().getByRole('button', { name: 'Add anyway', exact: true }).click()
  }
}
