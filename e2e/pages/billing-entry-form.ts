import { expect, type Page } from '@playwright/test'

export type BillingPaymentData = {
  patientName: string
  amount: string
  method: 'Cash' | 'UPI' | 'Card' | 'Bank Transfer'
  notes: string
}

export class BillingEntryForm {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.getByRole('button', { name: 'New billing entry', exact: true }).click()
    await expect(this.page.getByRole('dialog', { name: 'New Billing Entry' })).toBeVisible()
  }

  private async selectPatient(patientName: string): Promise<void> {
    await this.page.getByLabel('Patient *', { exact: true }).click()
    await this.page.getByPlaceholder('Search patient…', { exact: true }).fill(patientName)
    await this.page.getByRole('button', { name: patientName, exact: true }).click()
  }

  private async fillPayment(data: BillingPaymentData): Promise<void> {
    await this.selectPatient(data.patientName)
    await this.page.getByLabel('Amount Received *', { exact: true }).fill(data.amount)
    await this.page.getByLabel('Payment Method *', { exact: true }).click()
    await this.page.getByRole('option', { name: data.method, exact: true }).click()
    await this.page.getByLabel('Notes', { exact: true }).fill(data.notes)
  }

  async fillPaymentOnly(data: BillingPaymentData): Promise<void> {
    await this.fillPayment(data)
  }

  async fillPackageFromTemplate(
    data: Omit<BillingPaymentData, 'notes'> & { templateName: string; notes?: string },
  ): Promise<void> {
    await this.page.getByRole('button', { name: /Package \+ payment/i }).click()
    await this.selectPatient(data.patientName)
    await this.page.getByLabel('Package Template', { exact: true }).click()
    await this.page.getByRole('option', { name: new RegExp(`^${data.templateName}`) }).click()
    await this.page.getByLabel('Appointment Type *', { exact: true }).click()
    await this.page.getByRole('option', { name: 'Clinic', exact: true }).click()
    await this.page.getByLabel('Payment Method *', { exact: true }).click()
    await this.page.getByRole('option', { name: data.method, exact: true }).click()
    if (data.notes !== undefined) await this.page.getByLabel('Notes', { exact: true }).fill(data.notes)
  }

  async expectPackagePrefill(input: {
    name: string
    sessions: string
    rate: string
    amount: string
  }): Promise<void> {
    await expect(this.page.getByLabel('Package Name *', { exact: true })).toHaveValue(input.name)
    await expect(this.page.getByLabel('Sessions *', { exact: true })).toHaveValue(input.sessions)
    await expect(this.page.getByLabel('Per Session *', { exact: true })).toHaveValue(input.rate)
    await expect(this.page.getByLabel('Amount Received *', { exact: true })).toHaveValue(input.amount)
  }

  async submit(kind: 'payment' | 'package'): Promise<void> {
    await this.page.getByRole('button', {
      name: kind === 'payment' ? 'Save Payment' : 'Save Package',
      exact: true,
    }).click()
    await expect(this.page.getByRole('dialog', { name: 'New Billing Entry' })).toBeHidden()
    await expect(this.page.getByText(kind === 'payment' ? 'Payment recorded' : 'Package saved', { exact: true })).toBeVisible()
  }

  async voidPayment(patientName: string, amount: number): Promise<void> {
    await this.page.getByRole('button', { name: 'Payments', exact: true }).click()
    await this.page.getByRole('button', {
      name: `Cancel payment for ${patientName} · ₹${amount.toLocaleString('en-IN')}`,
      exact: true,
    }).click()
    const dialog = this.page.getByRole('alertdialog', { name: 'Cancel payment' })
    await dialog.getByLabel('Reason *', { exact: true }).fill('E2E correction')
    await dialog.getByRole('button', { name: 'Save audited change', exact: true }).click()
    await expect(this.page.getByText('Audited change saved', { exact: true })).toBeVisible()
  }

  async cancelPackage(patientName: string, packageName: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Packages', exact: true }).click()
    await this.page.getByRole('button', {
      name: `Cancel package for ${patientName} · ${packageName}`,
      exact: true,
    }).click()
    const dialog = this.page.getByRole('alertdialog', { name: 'Cancel package' })
    await dialog.getByLabel('Reason *', { exact: true }).fill('E2E package correction')
    await dialog.getByRole('button', { name: 'Save audited change', exact: true }).click()
    await expect(this.page.getByText('Audited change saved', { exact: true })).toBeVisible()
  }
}
