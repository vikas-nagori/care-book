import { expect, type Page } from '@playwright/test'

type SettingsSection =
  | 'Appointment Types'
  | 'Session Fees'
  | 'Package Templates'
  | 'Invite User'
  | 'Temporary Staff'
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

  async updateSessionFees(input: { clinicFee: string; homeVisitFee: string }): Promise<void> {
    await this.openSection('Session Fees')
    await this.page.getByLabel('Clinic Visit Fee (₹)', { exact: true }).fill(input.clinicFee)
    await this.page.getByLabel('Home Visit Fee (₹)', { exact: true }).fill(input.homeVisitFee)
    await this.page.getByRole('button', { name: 'Save Settings', exact: true }).click()
    await expect(this.page.getByText('Settings saved', { exact: true })).toBeVisible()
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

  async addExternalStaff(input: { name: string; phone: string; email?: string }): Promise<void> {
    await this.openSection('Temporary Staff')
    await this.page.getByLabel('Name *', { exact: true }).fill(input.name)
    await this.page.getByLabel('Phone *', { exact: true }).fill(input.phone)
    if (input.email !== undefined) await this.page.getByLabel('Temporary staff email', { exact: true }).fill(input.email)
    await this.page.getByRole('button', { name: 'Add Temporary Staff', exact: true }).click()
    await expect(this.page.getByText('Temporary staff added', { exact: true })).toBeVisible()
  }

  /** Creates the login and returns the one-time temporary password from the dialog. */
  /** Email and role are optional in the form; omitting them leaves the field blank / default. */
  async inviteUser(input: {
    name: string
    phone: string
    email?: string
    role?: 'Staff' | 'External Staff' | 'Admin'
  }): Promise<string> {
    await this.openSection('Invite User')
    await this.page.getByLabel('Invitee name', { exact: true }).fill(input.name)
    await this.page.getByLabel(/^Mobile number/).fill(input.phone)
    if (input.email !== undefined) await this.page.getByLabel('Invite email', { exact: true }).fill(input.email)
    if (input.role) {
      await this.page.getByLabel('Role', { exact: true }).click()
      await this.page.getByRole('option', { name: input.role, exact: true }).click()
    }
    await this.page.getByRole('button', { name: 'Create Login', exact: true }).click()
    return this.takeTempPassword()
  }

  /** Issues a fresh temp password for a pending invite and returns it. */
  /** `account` is the invite's email, or its formatted mobile number when it has none. */
  async issueNewTempPassword(account: string): Promise<string> {
    await this.openSection('Invites')
    await this.page.getByRole('button', { name: `New temporary password for ${account}`, exact: true }).click()
    return this.takeTempPassword()
  }

  private async takeTempPassword(): Promise<string> {
    const dialog = this.page.getByRole('dialog', { name: 'Temporary password issued' })
    const password = dialog.getByTestId('temp-password')
    await expect(password).toBeVisible()
    const value = (await password.textContent())?.trim() ?? ''
    expect(value).toMatch(/^[A-Za-z0-9]{14}$/)
    await expect(dialog.getByRole('button', { name: 'Copy login details', exact: true })).toBeVisible()

    // Phones get a bottom sheet pinned to the screen edge (like every other settings flow
    // there); desktop gets a centred dialog. Poll: the sheet slides in.
    const viewport = this.page.viewportSize()!
    const isPhone = viewport.width < 768
    await expect.poll(async () => {
      const box = await dialog.boundingBox()
      return box ? Math.abs(box.y + box.height - viewport.height) <= 2 : null
    }).toBe(isPhone)
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(dialog).toBeHidden()
    return value
  }

  /** `account` is the invite's email, or its formatted mobile number when it has none. */
  async revokeInvite(account: string): Promise<void> {
    await this.openSection('Invites')
    await this.page.getByRole('button', { name: `Revoke invite to ${account}`, exact: true }).click()
    await expect(this.page.getByText('Invite revoked', { exact: true })).toBeVisible()
  }
}
