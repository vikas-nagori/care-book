// Page objects for the External Staff workspace (/external, /external/patients): the booking
// dialog, the reschedule / cancel dialog and the patient profile dialog. Optional inputs are
// filled only when a spec passes them, so a spec can submit exactly what a user would.

import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'

import { PASSWORD } from '../support/accounts'
import { isMobileProject } from '../support/mobile'

/** Tap on the phone projects (touch is enabled there), click on desktop. */
export async function press(locator: Locator, testInfo: TestInfo): Promise<void> {
  if (isMobileProject(testInfo)) await locator.tap()
  else await locator.click()
}

/** The visible "New appointment" control: the toolbar button on desktop, the + button on a phone. */
export function newAppointmentButton(page: Page): Locator {
  return page.getByRole('button', { name: 'New appointment', exact: true }).filter({ visible: true })
}

/** A day-view chip (or week-view item) for `patientName` on the External Staff schedule. */
export function scheduleChip(page: Page, patientName: string): Locator {
  return page.getByRole('button', { name: new RegExp(escapeRegExp(patientName)) }).filter({ visible: true })
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export type ExternalBookingData = {
  /** Patient id; left alone when omitted (the dialog preselects a single or chosen patient). */
  patientId?: string
  /** Appointment type id; left alone when omitted (preselected when the clinic has one type). */
  typeId?: string
  /** YYYY-MM-DD; the dialog defaults to the selected day. */
  date?: string
  /** HH:mm. The only field the dialog never prefills. */
  time?: string
  /** Minutes; the dialog defaults to 30. */
  duration?: string
}

export class ExternalBookingDialog {
  readonly dialog: Locator
  readonly patient: Locator
  readonly type: Locator
  readonly date: Locator
  readonly time: Locator
  readonly duration: Locator
  /** Matches across both labels, so it can be asserted while pending. */
  readonly submit: Locator
  readonly cancel: Locator
  readonly alert: Locator

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'New appointment', exact: true })
    this.patient = this.dialog.getByLabel('Patient', { exact: true })
    this.type = this.dialog.getByLabel('Appointment type', { exact: true })
    this.date = this.dialog.getByLabel('Date', { exact: true })
    this.time = this.dialog.getByLabel('Time', { exact: true })
    this.duration = this.dialog.getByLabel('Duration (minutes)', { exact: true })
    this.submit = this.dialog.getByRole('button', { name: /^(Book appointment|Booking…)$/ })
    this.cancel = this.dialog.getByRole('button', { name: 'Cancel', exact: true })
    this.alert = this.dialog.getByRole('alert')
  }

  /** Open it from the schedule's "New appointment" control. */
  static async open(page: Page, testInfo: TestInfo): Promise<ExternalBookingDialog> {
    await press(newAppointmentButton(page), testInfo)
    const booking = new ExternalBookingDialog(page)
    await expect(booking.dialog).toBeVisible()
    return booking
  }

  async fill(data: ExternalBookingData): Promise<void> {
    if (data.patientId !== undefined) await this.patient.selectOption(data.patientId)
    if (data.typeId !== undefined) await this.type.selectOption(data.typeId)
    if (data.date !== undefined) await this.date.fill(data.date)
    if (data.time !== undefined) await this.time.fill(data.time)
    if (data.duration !== undefined) await this.duration.fill(data.duration)
  }
}

export class ExternalAppointmentDialog {
  readonly dialog: Locator
  readonly type: Locator
  readonly date: Locator
  readonly time: Locator
  readonly duration: Locator
  readonly save: Locator
  /** The ghost "Cancel appointment" button that opens the confirmation. */
  readonly startCancel: Locator
  /** The destructive confirm button (matches its pending label too). */
  readonly confirmCancel: Locator
  readonly keep: Locator
  readonly alert: Locator

  constructor(readonly page: Page, patientName: string) {
    this.dialog = page.getByRole('dialog', { name: patientName, exact: true })
    this.type = this.dialog.getByLabel('Appointment type', { exact: true })
    this.date = this.dialog.getByLabel('Date', { exact: true })
    this.time = this.dialog.getByLabel('Time', { exact: true })
    this.duration = this.dialog.getByLabel('Duration (minutes)', { exact: true })
    this.save = this.dialog.getByRole('button', { name: /^(Save changes|Saving…)$/ })
    this.startCancel = this.dialog.getByRole('button', { name: 'Cancel appointment', exact: true })
    this.confirmCancel = this.dialog.getByRole('button', { name: /^(Cancel appointment|Cancelling…)$/ })
    this.keep = this.dialog.getByRole('button', { name: 'Keep appointment', exact: true })
    this.alert = this.dialog.getByRole('alert')
  }

  /** Open the appointment from its chip on the day view at `/external?date=…`. */
  static async open(page: Page, testInfo: TestInfo, patientName: string): Promise<ExternalAppointmentDialog> {
    await press(scheduleChip(page, patientName).first(), testInfo)
    const opened = new ExternalAppointmentDialog(page, patientName)
    await expect(opened.dialog).toBeVisible()
    return opened
  }
}

/**
 * Sign the page in as another account through the real /login form (mobile number + password).
 * Clears the page's cookies first, so the project's stored session is dropped for this page's
 * context only. External Staff land on /external.
 */
export async function signInWithMobile(page: Page, input: { mobileNumber: string; password?: string }): Promise<void> {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('Mobile number', { exact: true }).fill(input.mobileNumber)
  await page.getByLabel('Password').fill(input.password ?? PASSWORD)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 })
}

/**
 * The local `next start` does not serve Vercel's `/_vercel/insights` and `/_vercel/speed-insights`
 * scripts, and the middleware redirects an External Staff GET for them to `/external`, whose HTML
 * Chromium then refuses as a script. assertions.ts already ignores that shape by tracking the
 * redirect, but its `response` event can arrive after the console message (seen once in CI), so
 * External Staff specs also name it here. Only this exact refusal of `/external` as a script.
 */
export const EXTERNAL_OBSERVABILITY_REDIRECT_NOISE = [{
  url: /^http:\/\/localhost:3000\//,
  text: /^Refused to execute script from 'http:\/\/localhost:3000\/external' because its MIME type \('text\/html'\) is not executable, and strict MIME type checking is enabled\.$/,
}] as const
