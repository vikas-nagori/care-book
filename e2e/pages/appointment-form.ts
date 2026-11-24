import { expect, type Locator, type Page } from '@playwright/test'

/** Optional inline-patient details. Every field but the phone is optional and filled only when passed. */
export type InlinePatientData = {
  phone: string
  age?: string
  email?: string
  gender?: 'Male' | 'Female' | 'Other'
  address?: string
  medicalHistory?: string
  notes?: string
  /** "Referred by doctor" with a brand-new doctor typed into the doctor picker. */
  newReferringDoctor?: { name: string; specialty?: string; address?: string }
}

export type AppointmentFormData = {
  patientName: string
  date: string
  time: string
  /** Optional in the form: blank books the default 45 minutes. */
  durationMinutes?: string
  /** Optional in the form: blank stores NULL. */
  notes?: string
  /** A type name, or `null` to leave the Type select on whatever the form preselected. */
  appointmentTypeName?: string | null
  assignedStaffLabel?: string | RegExp
  /** Admin-only Session Fee; `''` clears the auto-filled value. */
  fee?: string
  /** Create `patientName` inline instead of picking an existing patient. */
  newPatient?: InlinePatientData
}

/** Fields of the Edit Appointment form. Each is changed only when passed. */
export type AppointmentEditData = {
  patientName?: string
  date?: string
  time?: string
  durationMinutes?: string
  appointmentTypeName?: string
  assignedStaffLabel?: string | RegExp
  fee?: string
  status?: 'Scheduled' | 'Completed' | 'Cancelled'
  notes?: string
}

export type ClearableField = 'notes' | 'duration' | 'fee' | 'time'

const FIELD_LABELS: Record<ClearableField, string> = {
  notes: 'Notes',
  duration: 'Duration (min)',
  fee: 'Session Fee (₹)',
  time: 'Time *',
}

/**
 * The appointment form on `/schedule/new`, in the schedule / dashboard "New Appointment" dialogs
 * and in the detail page's "Edit Appointment" dialog. `scope` narrows every locator to one dialog
 * when the page holds more than one form.
 */
export class AppointmentForm {
  private readonly root: Page | Locator

  constructor(
    private readonly page: Page,
    private readonly defaultAppointmentTypeName: string,
    scope?: Locator,
  ) {
    this.root = scope ?? page
  }

  field(name: ClearableField): Locator {
    return this.root.getByLabel(FIELD_LABELS[name], { exact: true })
  }

  submitButton(): Locator {
    return this.root.locator('button[type="submit"]')
  }

  async fill(data: AppointmentFormData): Promise<void> {
    const patientSearch = this.root.getByLabel('Patient *', { exact: true })
    // WebKit can hydrate the form after the first keystrokes land, which resets the search box.
    // Refill until the typed name sticks.
    await expect(async () => {
      await patientSearch.fill(data.patientName)
      await expect(patientSearch).toHaveValue(data.patientName, { timeout: 1_000 })
    }).toPass()
    if (data.newPatient) {
      await this.root.getByRole('button', { name: `Create new patient: "${data.patientName}"`, exact: true }).click()
      await this.fillInlinePatient(data.newPatient)
    } else {
      await this.root.getByRole('button', { name: data.patientName, exact: true }).click()
    }

    await this.root.getByLabel('Date *', { exact: true }).fill(data.date)
    await this.root.getByLabel('Time *', { exact: true }).fill(data.time)
    if (data.durationMinutes !== undefined) await this.field('duration').fill(data.durationMinutes)
    if (data.notes !== undefined) await this.field('notes').fill(data.notes)

    if (data.appointmentTypeName !== null) {
      await this.chooseType(data.appointmentTypeName ?? this.defaultAppointmentTypeName)
    }
    if (data.assignedStaffLabel) await this.chooseAssignee(data.assignedStaffLabel)
    // Last: choosing a patient or type re-prices the fee.
    if (data.fee !== undefined) await this.fillFee(data.fee)
  }

  private async fillInlinePatient(patient: InlinePatientData): Promise<void> {
    await this.root.getByLabel('Phone *', { exact: true }).fill(patient.phone)
    if (patient.email !== undefined) await this.root.getByLabel('Email', { exact: true }).fill(patient.email)
    if (patient.age !== undefined) await this.root.getByLabel('Age (years)', { exact: true }).fill(patient.age)
    if (patient.gender !== undefined) {
      await this.root.getByLabel('Gender', { exact: true }).click()
      await this.page.getByRole('option', { name: patient.gender, exact: true }).click()
    }
    if (patient.address !== undefined) await this.root.getByLabel('Address', { exact: true }).fill(patient.address)
    if (patient.medicalHistory !== undefined) await this.root.getByLabel('Medical History', { exact: true }).fill(patient.medicalHistory)
    if (patient.notes !== undefined) await this.root.getByLabel('Patient Notes', { exact: true }).fill(patient.notes)
    if (patient.newReferringDoctor) {
      const doctor = patient.newReferringDoctor
      await this.root.getByLabel('How were they referred?', { exact: true }).click()
      await this.page.getByRole('option', { name: 'Referred by doctor', exact: true }).click()
      await this.root.getByLabel('Referring Doctor', { exact: true }).click()
      await this.root.getByPlaceholder('Search doctor name…').fill(doctor.name)
      await this.root.getByRole('button', { name: `Add doctor “${doctor.name}”`, exact: true }).click()
      await expect(this.root.getByLabel('Name *', { exact: true }).last()).toHaveValue(doctor.name)
      if (doctor.specialty !== undefined) await this.root.getByLabel('Specialty (optional)', { exact: true }).fill(doctor.specialty)
      if (doctor.address !== undefined) await this.root.getByLabel('Address (optional)', { exact: true }).fill(doctor.address)
    }
  }

  async chooseType(name: string): Promise<void> {
    await this.root.getByLabel('Type', { exact: true }).click()
    await this.page.getByRole('option', { name, exact: true }).click()
  }

  async chooseAssignee(label: string | RegExp): Promise<void> {
    await this.root.getByLabel('Assigned Staff', { exact: true }).click()
    await this.page.getByRole('option', { name: label, exact: typeof label === 'string' }).click()
  }

  async fillFee(value: string): Promise<void> {
    await this.field('fee').fill(value)
  }

  async clear(field: ClearableField): Promise<void> {
    await this.field(field).fill('')
    await expect(this.field(field)).toHaveValue('')
  }

  /** Edit mode: change only the fields passed. */
  async fillEdit(data: AppointmentEditData): Promise<void> {
    if (data.patientName !== undefined) {
      await this.root.getByLabel('Patient *', { exact: true }).click()
      await this.root.getByPlaceholder('Search patient…').fill(data.patientName)
      await this.root.getByRole('button', { name: data.patientName, exact: true }).click()
      await expect(this.root.getByLabel('Patient *', { exact: true })).toContainText(data.patientName)
    }
    if (data.date !== undefined) await this.root.getByLabel('Date *', { exact: true }).fill(data.date)
    if (data.time !== undefined) await this.field('time').fill(data.time)
    if (data.durationMinutes !== undefined) await this.field('duration').fill(data.durationMinutes)
    if (data.appointmentTypeName !== undefined) await this.chooseType(data.appointmentTypeName)
    if (data.assignedStaffLabel !== undefined) await this.chooseAssignee(data.assignedStaffLabel)
    if (data.fee !== undefined) await this.fillFee(data.fee)
    if (data.status !== undefined) {
      await this.root.getByLabel('Status', { exact: true }).click()
      await this.page.getByRole('option', { name: data.status, exact: true }).click()
    }
    if (data.notes !== undefined) await this.field('notes').fill(data.notes)
  }

  /** Edit mode: Update, then the success toast and the dialog closing. */
  async submitUpdate(): Promise<void> {
    await this.root.getByRole('button', { name: 'Update', exact: true }).click()
    await expect(this.page.getByText('Appointment updated', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  }

  async enableWeeklyRepeat(weekdayLabel: string, sessionCount: number): Promise<void> {
    const repeat = this.root.getByRole('switch', { name: 'Toggle repeat appointment' })
    await repeat.click()
    await expect(repeat).toHaveAttribute('aria-checked', 'true')

    const weekday = this.root.getByRole('button', { name: weekdayLabel, exact: true })
    if (await weekday.getAttribute('aria-pressed') !== 'true') await weekday.click()
    await this.root.getByLabel('Total sessions *', { exact: true }).fill(String(sessionCount))
    await expect(this.root.getByText(`${sessionCount} appointments`, { exact: true })).toBeVisible()
  }

  async submitAndExpectBooked(expectedCount = 1): Promise<void> {
    const name = expectedCount === 1 ? 'Book Appointment' : `Book ${expectedCount} appointments`
    await this.root.getByRole('button', { name, exact: true }).click()
    await expect(this.page).toHaveURL(/\/schedule(?:\?.*)?$/)
  }

  async submitAndExpectConflict(conflictDateText: string): Promise<void> {
    await this.root.getByRole('button', { name: /^Book \d+ appointments$/ }).click()
    const notifications = this.page.getByRole('region', { name: 'Notifications (F8)' })
    await expect(notifications.getByText('Appointment not booked', { exact: true })).toBeVisible()
    await expect(notifications).toContainText('This patient already has an appointment')
    await expect(notifications).toContainText(conflictDateText)
  }
}
