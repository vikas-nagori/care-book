import { expect, type Locator, type Page } from '@playwright/test'

export type SettingsSection =
  | 'Your Account'
  | 'Connected Apps'
  | 'Session Fees'
  | 'Appointment Types'
  | 'Package Templates'
  | 'Invite User'
  | 'Temporary Staff'
  | 'Invites'
  | 'Active Users'

/** Every section an admin sees, in the order the mobile list shows them. */
export const ADMIN_SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'Your Account',
  'Connected Apps',
  'Session Fees',
  'Appointment Types',
  'Package Templates',
  'Invite User',
  'Temporary Staff',
  'Invites',
  'Active Users',
]

/** Staff (profile-only access) see their own account and connected apps, nothing else. */
export const STAFF_SETTINGS_SECTIONS: readonly SettingsSection[] = ['Your Account', 'Connected Apps']

export type InviteInput = {
  name: string
  phone: string
  email?: string
  role?: 'Staff' | 'External Staff' | 'Admin'
}

export class SettingsView {
  constructor(private readonly page: Page) {}

  isMobile(): boolean {
    return (this.page.viewportSize()?.width ?? 1280) < 768
  }

  /**
   * Close whatever sheet or dialog is open, retrying until none is left: a sheet that is still
   * sliding in or out would make a one-shot `isVisible()` check lie.
   */
  async closeOpenDialogs(): Promise<void> {
    await expect(async () => {
      const open = this.page.getByRole('dialog').filter({ visible: true })
      if (await open.count() > 0) {
        await open.first().getByRole('button', { name: 'Close', exact: true }).click({ timeout: 2_000 })
      }
      await expect(this.page.getByRole('dialog')).toHaveCount(0, { timeout: 1_000 })
    }).toPass({ timeout: 10_000 })
  }

  /** On a phone, opens the section's bottom sheet; on desktop every section is already on screen. */
  async openSection(section: SettingsSection): Promise<void> {
    if (!this.isMobile()) return
    const target = this.page.getByRole('dialog', { name: section, exact: true })
    if (await target.isVisible()) return
    await this.closeOpenDialogs()
    await this.page.getByRole('button', { name: new RegExp(`^${section}`) }).click()
    await expect(target).toBeVisible()
  }

  /** The sheet on a phone, the whole page on desktop: where a section's controls live. */
  sectionScope(section: SettingsSection): Locator {
    return this.isMobile()
      ? this.page.getByRole('dialog', { name: section, exact: true })
      : this.page.locator('body')
  }

  /**
   * Open every section in turn and run `assert` on it. On a phone that is each bottom sheet (the
   * screens an admin actually sees there); on desktop all panels render at once, so `assert` runs
   * once on the page with section `null`.
   */
  async visitEverySection(
    assert: (scope: Locator, section: SettingsSection | null) => Promise<void>,
    sections: readonly SettingsSection[] = ADMIN_SETTINGS_SECTIONS,
  ): Promise<void> {
    if (!this.isMobile()) {
      await assert(this.page.locator('body'), null)
      return
    }
    for (const section of sections) {
      await this.openSection(section)
      await assert(this.sectionScope(section), section)
    }
    await this.closeOpenDialogs()
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

  /** One Temporary Staff entry: a card in the phone sheet, a table row on desktop. */
  temporaryStaffRow(name: string): Locator {
    return this.isMobile()
      ? this.page.getByRole('dialog', { name: 'Temporary Staff', exact: true }).locator('section').filter({ hasText: name })
      : this.page.getByRole('row').filter({ hasText: name })
  }

  /** The row's "Create login" button, matched in its idle and pending states. */
  createLoginForTemporaryStaffButton(name: string): Locator {
    return this.temporaryStaffRow(name).getByRole('button', { name: /^(Create login|Creating\.\.\.)$/ })
  }

  /**
   * Temporary Staff → Create login: types `email` into the row (when given) and taps the row's
   * button. Does not wait for the outcome; follow with takeTempPassword() or a failure check.
   */
  async createLoginForTemporaryStaff(name: string, input: { email?: string } = {}): Promise<Locator> {
    await this.openSection('Temporary Staff')
    const row = this.temporaryStaffRow(name)
    await expect(row).toBeVisible()
    if (input.email !== undefined) await row.getByLabel(`Invite email for ${name}`, { exact: true }).fill(input.email)
    const button = this.createLoginForTemporaryStaffButton(name)
    await button.click()
    return button
  }

  /** Invite User → Create Login, matched in its idle and pending states. */
  createLoginButton(): Locator {
    return this.sectionScope('Invite User').getByRole('button', { name: /^(Create Login|Creating login…)$/ })
  }

  /** Fills Invite User; optional fields are left blank unless passed. */
  async fillInvite(input: InviteInput): Promise<void> {
    await this.openSection('Invite User')
    await this.page.getByLabel('Invitee name', { exact: true }).fill(input.name)
    await this.page.getByLabel(/^Mobile number/).fill(input.phone)
    if (input.email !== undefined) await this.page.getByLabel('Invite email', { exact: true }).fill(input.email)
    if (input.role) {
      await this.page.getByLabel('Role', { exact: true }).click()
      await this.page.getByRole('option', { name: input.role, exact: true }).click()
    }
  }

  /** Fills Invite User and taps Create Login without waiting for the outcome. */
  async submitInvite(input: InviteInput): Promise<Locator> {
    await this.fillInvite(input)
    const button = this.createLoginButton()
    await button.click()
    return button
  }

  /** Creates the login and returns the one-time temporary password from the dialog. */
  /** Email and role are optional in the form; omitting them leaves the field blank / default. */
  async inviteUser(input: InviteInput): Promise<string> {
    await this.submitInvite(input)
    return this.takeTempPassword()
  }

  /** Issues a fresh temp password for a pending invite and returns it. */
  /** `account` is the invite's email, or its formatted mobile number when it has none. */
  async issueNewTempPassword(account: string): Promise<string> {
    await this.openSection('Invites')
    await this.page.getByRole('button', { name: `New temporary password for ${account}`, exact: true }).click()
    return this.takeTempPassword()
  }

  tempPasswordDialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Temporary password issued' })
  }

  /**
   * Reads the one-time password from the hand-over dialog and checks it is a bottom sheet on a
   * phone and a centred dialog on desktop. Closes it with Done unless `keepOpen`.
   */
  async takeTempPassword(options: { keepOpen?: boolean } = {}): Promise<string> {
    const dialog = this.tempPasswordDialog()
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
    if (!options.keepOpen) {
      await dialog.getByRole('button', { name: 'Done', exact: true }).click()
      await expect(dialog).toBeHidden()
    }
    return value
  }

  /** `account` is the invite's email, or its formatted mobile number when it has none. */
  newPasswordButton(account: string): Locator {
    return this.page.getByRole('button', { name: `New temporary password for ${account}`, exact: true }).filter({ visible: true })
  }

  revokeButton(account: string): Locator {
    return this.page.getByRole('button', { name: `Revoke invite to ${account}`, exact: true }).filter({ visible: true })
  }

  /** `account` is the invite's email, or its formatted mobile number when it has none. */
  async revokeInvite(account: string): Promise<void> {
    await this.openSection('Invites')
    await this.revokeButton(account).click()
    await expect(this.page.getByText('Invite revoked', { exact: true })).toBeVisible()
  }

  /** The Logout button: in the Your Account sheet on a phone, the account card on desktop. */
  async logoutButton(): Promise<Locator> {
    await this.openSection('Your Account')
    return this.sectionScope('Your Account').getByRole('button', { name: 'Logout', exact: true })
  }
}

/** `98765 43210`: how the app shows a 10-digit mobile number. */
export function formatMobile(mobile: string): string {
  return `${mobile.slice(0, 5)} ${mobile.slice(5)}`
}
