import { expect, type Page } from '@playwright/test'

type SettingsSection =
  | 'Appointment Types'
  | 'Package Templates'
  | 'Invite User'
  | 'External Staff'
  | 'Invites'

export class SettingsView {
  constructor(private readonly page: Page) {}

  private isMobile(): boolean {
    return (this.page.viewportSize()?.width ?? 1280) < 768
  }

  async openSection(section: SettingsSection): Promise<void> {
    if (!this.isMobile()) return
    const openDialog = this.page.getByRole('dialog')
    if (await openDialog.isVisible().catch(() => false)) {
      await openDialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(openDialog).toBeHidden()
    }
    await this.page.getByRole('button', { name: new RegExp(`^${section}`) }).click()
    await expect(this.page.getByRole('dialog', { name: section })).toBeVisible()
  }

  async addAppointmentType(input: { name: string; rate: string }): Promise<void> {
    await this.openSection('Appointment Types')
    await this.page.getByRole('button', { name: 'Add appointment type', exact: true }).click()
    await this.page.getByLabel('Appointment type name', { exact: true }).fill(input.name)
    await this.page.getByLabel('Session rate (₹)', { exact: true }).fill(input.rate)
    await this.page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(this.page.getByText('Appointment type added', { exact: true })).toBeVisible()
  }

  async editAppointmentType(name: string, updated: { name: string; rate: string }): Promise<void> {
    await this.page.getByRole('button', { name: `Edit ${name}`, exact: true }).click()
    await this.page.getByLabel('Appointment type name', { exact: true }).fill(updated.name)
    await this.page.getByLabel('Session rate (₹)', { exact: true }).fill(updated.rate)
    await this.page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(this.page.getByText('Appointment type updated', { exact: true })).toBeVisible()
  }

  async deleteAppointmentType(name: string): Promise<void> {
    await this.page.getByRole('button', { name: `Delete ${name}`, exact: true }).click()
    await expect(this.page.getByText('Appointment type deleted', { exact: true })).toBeVisible()
  }

  async addPackageTemplate(input: { name: string; sessions: string; rate: string }): Promise<void> {
    await this.openSection('Package Templates')
    await this.page.getByRole('button', { name: 'Add package template', exact: true }).click()
    await this.page.getByLabel('Package template name', { exact: true }).fill(input.name)
    await this.page.getByLabel('Minimum sessions', { exact: true }).fill(input.sessions)
    await this.page.getByLabel('Rate / session (₹)', { exact: true }).fill(input.rate)
    await this.page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(this.page.getByText('Template added', { exact: true })).toBeVisible()
  }

  async editPackageTemplate(name: string, updated: { name: string; sessions: string; rate: string }): Promise<void> {
    await this.page.getByRole('button', { name: `Edit ${name}`, exact: true }).click()
    await this.page.getByLabel('Package template name', { exact: true }).fill(updated.name)
    await this.page.getByLabel('Minimum sessions', { exact: true }).fill(updated.sessions)
    await this.page.getByLabel('Rate / session (₹)', { exact: true }).fill(updated.rate)
    await this.page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(this.page.getByText('Template updated', { exact: true })).toBeVisible()
  }

  async deletePackageTemplate(name: string): Promise<void> {
    await this.page.getByRole('button', { name: `Delete ${name}`, exact: true }).click()
    await expect(this.page.getByText('Template deleted', { exact: true })).toBeVisible()
  }

  async addExternalStaff(input: { name: string; phone: string; email: string }): Promise<void> {
    await this.openSection('External Staff')
    await this.page.getByLabel('Name *', { exact: true }).fill(input.name)
    await this.page.getByLabel('Phone *', { exact: true }).fill(input.phone)
    await this.page.getByLabel('External staff email', { exact: true }).fill(input.email)
    await this.page.getByRole('button', { name: 'Add External Staff', exact: true }).click()
    await expect(this.page.getByText('External staff added', { exact: true })).toBeVisible()
  }

  async inviteUser(input: { name: string; phone: string; email: string }): Promise<void> {
    await this.openSection('Invite User')
    await this.page.getByLabel('Invitee name', { exact: true }).fill(input.name)
    await this.page.getByLabel('Mobile number', { exact: true }).fill(input.phone)
    await this.page.getByLabel('Invite email', { exact: true }).fill(input.email)
    await this.page.getByRole('button', { name: 'Send Invite', exact: true }).click()
    await expect(this.page.getByText('Invite sent', { exact: true })).toBeVisible()
  }

  async resendInvite(email: string): Promise<void> {
    await this.openSection('Invites')
    await this.page.getByRole('button', { name: `Resend invite to ${email}`, exact: true }).click()
    await expect(this.page.getByText('Invite resent', { exact: true })).toBeVisible()
  }

  async revokeInvite(email: string): Promise<void> {
    await this.page.getByRole('button', { name: `Revoke invite to ${email}`, exact: true }).click()
    await expect(this.page.getByText('Invite revoked', { exact: true })).toBeVisible()
  }
}
