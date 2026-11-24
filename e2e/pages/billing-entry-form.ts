import { expect, type Locator, type Page, type Request } from '@playwright/test'

import { expectNoLeakedNulls } from '../support/assertions'
import { expandDateGroup } from '../support/date-groups'
import { expectFailureMessage } from '../support/fault-injection'

export type BillingPaymentMethod = 'Cash' | 'UPI' | 'Card' | 'Bank Transfer'

export type BillingPaymentData = {
  patientName: string
  amount: string
  /** Left untouched when omitted: the form then submits its default, UPI. */
  method?: BillingPaymentMethod
  /** Optional in the form: blank stores NULL. */
  notes?: string
}

export type BillingPackageData = {
  patientName: string
  packageName: string
  sessions: string
  rate: string
  /** The appointment type the package covers (required by the form). */
  appointmentType?: string
  /** Left untouched when omitted (UPI). */
  method?: BillingPaymentMethod
  notes?: string
}

export type AuditDialogKind = 'Cancel payment' | 'Cancel package' | 'Record refund' | 'Reverse refund'

/** True for the POST a server action sends (the outstanding-charges preview and every save). */
export function isServerActionPost(request: Request): boolean {
  return request.method() === 'POST' && request.headers()['next-action'] !== undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function rupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`
}

export class BillingEntryForm {
  constructor(private readonly page: Page) {}

  get dialog(): Locator {
    return this.page.getByRole('dialog', { name: 'New Billing Entry' })
  }

  /** The submit button in either label, so it keeps matching while it shows "Saving...". */
  saveButton(kind: 'payment' | 'package'): Locator {
    const idle = kind === 'payment' ? 'Save Payment' : 'Save Package'
    return this.dialog.getByRole('button', { name: new RegExp(`^(${idle}|Saving\\.\\.\\.)$`) })
  }

  get amountInput(): Locator {
    return this.dialog.getByLabel('Amount Received *', { exact: true })
  }

  get notesInput(): Locator {
    return this.dialog.getByLabel('Notes', { exact: true })
  }

  get dateInput(): Locator {
    return this.dialog.getByLabel('Payment Date *', { exact: true })
  }

  async open(): Promise<void> {
    // The trigger is server-rendered before hydration; retry until the dialog actually opens.
    await expect(async () => {
      if (!(await this.dialog.isVisible())) {
        await this.page.getByRole('button', { name: 'New billing entry', exact: true }).click()
      }
      await expect(this.dialog).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 15_000 })
  }

  async selectPatientByName(patientName: string): Promise<void> {
    await this.selectPatient(patientName)
  }

  /**
   * Pick the patient and wait for the outstanding-charges preview action that the pick fires, so
   * a fault or request counter installed afterwards only sees the save.
   */
  async selectPatientAndWaitForPreview(patientName: string): Promise<void> {
    const preview = this.page.waitForResponse((response) => isServerActionPost(response.request()))
    await this.selectPatient(patientName)
    await preview
  }

  private async selectPatient(patientName: string): Promise<void> {
    await this.page.getByLabel('Patient *', { exact: true }).click()
    await this.page.getByPlaceholder('Search patient…', { exact: true }).fill(patientName)
    await this.page.getByRole('button', { name: patientName, exact: true }).click()
  }

  private async chooseMethod(method: BillingPaymentMethod | undefined): Promise<void> {
    if (method === undefined) return
    await this.page.getByLabel('Payment Method *', { exact: true }).click()
    await this.page.getByRole('option', { name: method, exact: true }).click()
  }

  private async fillPayment(data: BillingPaymentData, waitForPreview = false): Promise<void> {
    if (waitForPreview) await this.selectPatientAndWaitForPreview(data.patientName)
    else await this.selectPatient(data.patientName)
    await this.amountInput.fill(data.amount)
    await this.chooseMethod(data.method)
    if (data.notes !== undefined) await this.notesInput.fill(data.notes)
  }

  async fillPaymentOnly(data: BillingPaymentData, options: { waitForPreview?: boolean } = {}): Promise<void> {
    await this.fillPayment(data, options.waitForPreview)
  }

  async switchToPackage(): Promise<void> {
    await this.page.getByRole('button', { name: /Package \+ payment/i }).click()
    await expect(this.dialog.getByLabel('Package Name *', { exact: true })).toBeVisible()
  }

  async fillPackageFromTemplate(
    data: Omit<BillingPaymentData, 'notes'> & { templateName: string; notes?: string },
  ): Promise<void> {
    await this.switchToPackage()
    await this.selectPatient(data.patientName)
    await this.page.getByLabel('Package Template', { exact: true }).click()
    await this.page.getByRole('option', { name: new RegExp(`^${data.templateName}`) }).click()
    await this.page.getByLabel('Appointment Type *', { exact: true }).click()
    await this.page.getByRole('option', { name: 'Clinic', exact: true }).click()
    await this.chooseMethod(data.method)
    if (data.notes !== undefined) await this.notesInput.fill(data.notes)
  }

  /** A package typed in by hand, no template. Start date, method and notes keep their defaults unless passed. */
  async fillPackageManual(data: BillingPackageData, options: { waitForPreview?: boolean } = {}): Promise<void> {
    await this.switchToPackage()
    if (options.waitForPreview) await this.selectPatientAndWaitForPreview(data.patientName)
    else await this.selectPatient(data.patientName)
    await this.dialog.getByLabel('Package Name *', { exact: true }).fill(data.packageName)
    await this.dialog.getByLabel('Sessions *', { exact: true }).fill(data.sessions)
    await this.dialog.getByLabel('Per Session *', { exact: true }).fill(data.rate)
    await this.page.getByLabel('Appointment Type *', { exact: true }).click()
    await this.page.getByRole('option', { name: data.appointmentType ?? 'Clinic', exact: true }).click()
    await this.chooseMethod(data.method)
    if (data.notes !== undefined) await this.notesInput.fill(data.notes)
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
    await expect(this.dialog).toBeHidden()
    await expect(this.page.getByText(kind === 'payment' ? 'Payment recorded' : 'Package saved', { exact: true })).toBeVisible()
  }

  /** Submit a save the server refuses: the toast names the failure and the dialog stays open. */
  async submitExpectingError(kind: 'payment' | 'package', message?: string | RegExp): Promise<void> {
    await this.saveButton(kind).click()
    await expectFailureMessage(this.page, 'Billing entry not saved')
    if (message !== undefined) await expectFailureMessage(this.page, message)
    await expect(this.dialog).toBeVisible()
  }

  async voidPayment(patientName: string, amount: number): Promise<void> {
    await openBillingTab(this.page, 'Payments')
    const dialog = await openAuditDialog(this.page, paymentActionButton(this.page, 'Cancel', patientName, amount), 'Cancel payment')
    await dialog.getByLabel('Reason *', { exact: true }).fill('E2E correction')
    await dialog.getByRole('button', { name: 'Save audited change', exact: true }).click()
    await expect(this.page.getByText('Audited change saved', { exact: true })).toBeVisible()
  }

  async cancelPackage(patientName: string, packageName: string): Promise<void> {
    await openBillingTab(this.page, 'Packages')
    const dialog = await openAuditDialog(this.page, packageCancelButton(this.page, patientName, packageName), 'Cancel package')
    await expect(dialog.getByText(/payment recorded for this package will also be cancelled/i)).toBeVisible()
    await dialog.getByLabel('Reason *', { exact: true }).fill('E2E package correction')
    await dialog.getByRole('button', { name: 'Save audited change', exact: true }).click()
    await expect(this.page.getByText('Audited change saved', { exact: true })).toBeVisible()
  }

  /** Refund part of a payment from its row (the visible desktop or mobile twin of the Refund button). */
  async refundPayment(patientName: string, amount: number, input: { refundAmount?: number; reason: string }): Promise<void> {
    await openBillingTab(this.page, 'Payments')
    const dialog = await openAuditDialog(this.page, paymentActionButton(this.page, 'Refund', patientName, amount), 'Record refund')
    if (input.refundAmount !== undefined) await dialog.getByLabel('Amount *', { exact: true }).fill(String(input.refundAmount))
    await dialog.getByLabel('Reason *', { exact: true }).fill(input.reason)
    await dialog.getByRole('button', { name: 'Save audited change', exact: true }).click()
    await expect(this.page.getByText('Audited change saved', { exact: true }).first()).toBeVisible()
    await expect(dialog).toBeHidden()
  }

  /** Reverse the refund whose history row carries `refundReason`. */
  async reverseRefund(refundReason: string, refundAmount: number, reason: string): Promise<void> {
    await openBillingTab(this.page, 'Payments')
    const dialog = await openAuditDialog(this.page, reverseRefundButton(this.page, refundReason, refundAmount), 'Reverse refund')
    await dialog.getByLabel('Reason *', { exact: true }).fill(reason)
    await dialog.getByRole('button', { name: 'Save audited change', exact: true }).click()
    await expect(this.page.getByText('Audited change saved', { exact: true }).first()).toBeVisible()
    await expect(dialog).toBeHidden()
  }
}

// ---------------------------------------------------------------------------------------------
// Billing screen helpers (Billing package, plan 5.3)

const TAB_HEADINGS: Record<'Overview' | 'Payments Balance' | 'Payments' | 'Packages', RegExp> = {
  Overview: /^Recent payments$/,
  'Payments Balance': /^Payments Balance · \d+$/,
  Payments: /^Payments · \d+$/,
  Packages: /^Packages · \d+$/,
}

/** Switch the /billing tab, retrying a click that lands before hydration. */
export async function openBillingTab(page: Page, tab: keyof typeof TAB_HEADINGS): Promise<void> {
  const heading = page.getByRole('heading', { name: TAB_HEADINGS[tab] })
  await expect(async () => {
    if (!(await heading.isVisible())) await page.getByRole('button', { name: tab, exact: true }).click()
    await expect(heading).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
}

/** Lists past the first ten rows hide behind "View more (N more)"; open it when it is there. */
export async function revealAllRows(page: Page): Promise<void> {
  const viewMore = page.getByRole('button', { name: /^View more \(\d+ more\)$/ })
  if (await viewMore.isVisible()) {
    await viewMore.click()
    await expect(page.getByRole('button', { name: 'Show less', exact: true })).toBeVisible()
  }
}

/** The visible (desktop or mobile) Refund / Cancel button on one payment row. */
export function paymentActionButton(page: Page, action: 'Refund' | 'Cancel', patientName: string, amount: number): Locator {
  return page.getByRole('button', { name: `${action} payment for ${patientName} · ${rupees(amount)}`, exact: true })
}

export function packageCancelButton(page: Page, patientName: string, packageName: string): Locator {
  return page.getByRole('button', { name: `Cancel package for ${patientName} · ${packageName}`, exact: true })
}

/** The refund-history row carrying `refundReason`. */
export function refundHistoryRow(page: Page, refundReason: string): Locator {
  return page.locator('div.text-xs').filter({ hasText: refundReason })
}

export function reverseRefundButton(page: Page, refundReason: string, refundAmount: number): Locator {
  return refundHistoryRow(page, refundReason).getByRole('button', { name: `Reverse refund ${rupees(refundAmount)}`, exact: true })
}

export function auditDialog(page: Page, kind: AuditDialogKind): Locator {
  return page.getByRole('alertdialog', { name: kind })
}

export function auditSaveButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: /^(Save audited change|Saving…)$/ })
}

/** Reveal the row if it sits past the first ten, then open its audited-change dialog. */
export async function openAuditDialog(page: Page, trigger: Locator, kind: AuditDialogKind): Promise<Locator> {
  if (!(await trigger.isVisible())) await revealAllRows(page)
  const dialog = auditDialog(page, kind)
  await expect(async () => {
    if (!(await dialog.isVisible())) await trigger.click()
    await expect(dialog).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
  return dialog
}

/** Lines of text that start or end on a separator, or hold two in a row: a blank optional field glued in. */
export function danglingSeparators(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter((line) =>
    /^·|·$|·\s*·/.test(line))
}

/**
 * Open a metric drill-down and every date on it (the records sit behind collapsed accordions),
 * then leak-check. An empty month shows its empty label instead.
 */
async function visitMetric(page: Page, slug: 'billed-this-month' | 'received-this-month'): Promise<void> {
  await page.goto(`/billing/metrics/${slug}`)
  const list = page.getByTestId('date-group-list')
  await expect(list).toBeVisible()
  const headers = page.getByTestId('date-group-header')
  const count = await headers.count()
  for (let index = 0; index < count; index++) await expandDateGroup(headers.nth(index))
  await expectNoLeakedNulls(page)
}

/**
 * Every screen that renders a patient's billing, each leak-checked (plan 5.3): the four /billing
 * tabs with their lists fully revealed, the three metric drill-downs with every date opened, the
 * payment-due page and its PDF dialog, the package detail, the patient's Billing tab and the
 * dashboard. On a phone the hidden desktop twin is scanned too (expectNoLeakedNulls' hiddenWords).
 */
export async function visitEveryBillingScreen(
  page: Page,
  input: { patientId: string; packageId?: string },
): Promise<void> {
  await page.goto('/billing')
  await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible()
  await openBillingTab(page, 'Overview')
  await expectNoLeakedNulls(page)
  for (const tab of ['Payments Balance', 'Payments', 'Packages'] as const) {
    await openBillingTab(page, tab)
    if (tab !== 'Payments Balance') await revealAllRows(page)
    await expectNoLeakedNulls(page)
  }

  await visitMetric(page, 'billed-this-month')
  await visitMetric(page, 'received-this-month')
  await page.goto('/billing/metrics/billed-last-month')
  await expect(page.getByRole('group', { name: 'Monthly total billed trend' })).toBeVisible()
  await expectNoLeakedNulls(page)

  await page.goto(`/billing/payment-due/${input.patientId}`)
  const share = page.getByRole('button', { name: 'Share payment PDF', exact: true })
  await expect(share).toBeVisible()
  await expectNoLeakedNulls(page)
  const pdfDialog = page.getByRole('dialog', { name: 'Generate payment PDF' })
  await expect(async () => {
    if (!(await pdfDialog.isVisible())) await share.click()
    await expect(pdfDialog).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
  await expectNoLeakedNulls(page, { scope: pdfDialog })
  await page.keyboard.press('Escape')
  await expect(pdfDialog).toBeHidden()

  if (input.packageId) {
    await page.goto(`/billing/packages/${input.packageId}`)
    await expect(page.getByRole('heading', { name: /^Session history · \d+$/ })).toBeVisible()
    await expectNoLeakedNulls(page)
  }

  await openPatientBillingTab(page, input.patientId)
  await expectNoLeakedNulls(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await expectNoLeakedNulls(page)
}

export async function openPatientBillingTab(page: Page, patientId: string): Promise<void> {
  await page.goto(`/patients/${patientId}`)
  const tab = page.getByRole('tab', { name: 'Billing', exact: true })
  await expect(async () => {
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
}

/** The Payments Balance row for one patient, paging through the 25-per-page list until it appears. */
export async function findBalanceRow(page: Page, patientId: string): Promise<Locator> {
  await openBillingTab(page, 'Payments Balance')
  const row = page.locator(`a[href="/billing/payment-due/${patientId}"]`)
  const next = page.getByRole('navigation', { name: 'Payments balance pages' }).getByRole('button', { name: 'Next', exact: true })
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await row.isVisible()) return row
    if (!(await next.isVisible()) || !(await next.isEnabled())) break
    await next.click()
  }
  await expect(row).toBeVisible()
  return row
}

export const patientNamePattern = (name: string) => new RegExp(escapeRegExp(name))
