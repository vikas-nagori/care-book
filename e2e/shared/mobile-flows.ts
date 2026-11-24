// The "primary flows" of plan section 5.7: what a clinician does on a phone many times a day.
// Each flow opens its form the way a phone user does, types every field, and knows how to count
// the records its submit created, so the lifecycle specs (resume, stale build, no signal, double
// tap) can drive them all the same way. Not a spec file: shared by e2e/shared/mobile-*.spec.ts.

import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'

import { AppointmentForm } from '../pages/appointment-form'
import { PatientForm } from '../pages/patient-form'
import { SessionNoteForm } from '../pages/session-note-form'
import { SettingsView } from '../pages/settings-view'
import { CLINIC_A } from '../support/accounts'
import { attachErrorGuards, type ExpectedConsoleFailure } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import type { E2EFactory } from '../support/factories'
import { expectedFaultConsoleErrors } from '../support/fault-injection'
import { isMobileProject, projectRole } from '../support/mobile'
import { adminClient } from '../support/supabase-admin'

export type FlowId =
  | 'book-schedule'
  | 'book-dashboard'
  | 'session-notes'
  | 'reminder'
  | 'patient'
  | 'payment'
  | 'create-login'

/** How the flow's submit reaches the server. */
export type FlowTransport = 'server-action' | 'booking-api' | 'supabase'

export type OpenFlow = {
  /** Where the form lives; `open` navigates here first. */
  path: string
  /** Opens the form on the current page (again, e.g. after a reload) without navigating. */
  openForm(): Promise<void>
  /** The submit control, matched across its idle and pending labels. */
  submit: Locator
  idleName: string
  /** The dialog or page section the form lives in. */
  container: Locator
  /** Types every field the form has (or, for the booking flows, every field the POM knows). */
  fill(): Promise<void>
  /** Every typed value is still in its field. */
  expectFilled(): Promise<void>
  /** How many records this flow's submits have created so far. */
  rows(): Promise<number>
  /** What the user sees after one good submit. */
  expectSaved(): Promise<void>
}

export type Flow = {
  id: FlowId
  title: string
  transport: FlowTransport
  adminOnly?: boolean
  open(page: Page, factory: E2EFactory): Promise<OpenFlow>
}

export const BOOKINGS_PATH = '/api/appointments/bookings'

export function toastRegion(page: Page): Locator {
  return page.getByRole('region', { name: /^Notifications/ })
}

/** Why a test does not run on this project, or null when it does (desktop never runs these). */
export function phoneSkipReason(testInfo: TestInfo, flow?: Pick<Flow, 'adminOnly'>): string | null {
  if (!isMobileProject(testInfo)) return 'phone-only: the installed app is the primary client (plan 5.7)'
  if (flow?.adminOnly && projectRole(testInfo) !== 'admin') return 'admin-only flow'
  return null
}

/**
 * Error guards for these specs: the telemetry budget can answer 429 when the matrix runs back to
 * back, and every injected fault logs the browser's own "Failed to load resource" line.
 */
export function phoneGuards(page: Page, extra: {
  failures?: readonly ExpectedConsoleFailure[]
  httpErrors?: readonly { pathname: string; status: number }[]
  allowCrashText?: readonly string[]
} = {}) {
  return attachErrorGuards(page, {
    expectedFailures: [...expectedFaultConsoleErrors('server-action'), ...(extra.failures ?? [])],
    expectedHttpErrors: [{ pathname: '/api/telemetry', status: 429 }, ...(extra.httpErrors ?? [])],
    allowCrashText: extra.allowCrashText,
  })
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function countRows(table: string, column: string, value: string): Promise<number> {
  const { count, error } = await adminClient()
    .from(table).select('id', { count: 'exact', head: true }).eq('clinic_id', CLINIC_A.id).eq(column, value)
  if (error) throw new Error(`count ${table}.${column}: ${error.message}`)
  return count ?? 0
}

/** A per-test slot far from the windows count-sensitive specs assert on. */
function bookingSlot(factory: E2EFactory, offset: number) {
  const minute = 5 * (Number.parseInt(factory.token.slice(-2), 16) % 11)
  return { date: clinicDate(offset), time: `11:${String(minute).padStart(2, '0')}` }
}

async function bookingFlow(page: Page, factory: E2EFactory, where: 'schedule' | 'dashboard'): Promise<OpenFlow> {
  const patient = await factory.createPatient()
  const type = await factory.findAppointmentType(true)
  const slot = bookingSlot(factory, where === 'schedule' ? 176 : 177)
  const notes = factory.uniqueName(`${where}-booking`)
  factory.watchUiAppointments({ patientId: patient.id, notes })

  const path = where === 'schedule' ? `/schedule?date=${slot.date}` : '/'
  const dialog = page.getByRole('dialog', { name: 'New Appointment', exact: true })
  const openForm = async () => {
    const trigger = where === 'schedule'
      ? page.getByRole('button', { name: /^New appointment$/i }).filter({ visible: true })
      : page.getByRole('button', { name: 'New appt', exact: true })
    await trigger.tap()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Patient *', { exact: true })).toBeVisible()
  }
  await page.goto(path)
  await openForm()
  const form = new AppointmentForm(page, type.name)
  return {
    path,
    openForm,
    container: dialog,
    submit: dialog.getByRole('button', { name: /^(Book Appointment|Saving…)$/ }),
    idleName: 'Book Appointment',
    async fill() {
      await form.fill({ patientName: patient.name as string, date: slot.date, time: slot.time, durationMinutes: '50', notes })
    },
    async expectFilled() {
      await expect(dialog.getByLabel('Patient *', { exact: true })).toHaveValue(patient.name as string)
      await expect(dialog.getByLabel('Date *', { exact: true })).toHaveValue(slot.date)
      await expect(dialog.getByLabel('Time *', { exact: true })).toHaveValue(slot.time)
      await expect(dialog.getByLabel('Duration (min)', { exact: true })).toHaveValue('50')
      await expect(dialog.getByLabel('Notes', { exact: true })).toHaveValue(notes)
      await expect(dialog.getByLabel('Type', { exact: true })).toContainText(type.name)
    },
    rows: async () => (await factory.findAppointments({ patientId: patient.id, notes })).length,
    async expectSaved() {
      await expect(dialog).toBeHidden()
      await expect(toastRegion(page).getByText('Appointment booked', { exact: true })).toBeVisible()
    },
  }
}

async function sessionNotesFlow(page: Page, factory: E2EFactory): Promise<OpenFlow> {
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(-47), time: '14:10', status: 'completed' })
  factory.watchUiSessionNote(appointment.id)
  const values = {
    subjective: factory.uniqueName('subjective'),
    objective: factory.uniqueName('objective'),
    assessment: factory.uniqueName('assessment'),
    plan: factory.uniqueName('plan'),
    exercises: factory.uniqueName('exercises'),
  }
  const path = `/schedule/${appointment.id}`
  const dialog = page.getByRole('dialog', { name: 'Session Notes (SOAP)' })
  const openForm = async () => {
    await page.getByRole('button', { name: 'Add Notes', exact: true }).tap()
    await expect(dialog).toBeVisible()
  }
  await page.goto(path)
  await openForm()
  return {
    path,
    openForm,
    container: dialog,
    submit: dialog.getByRole('button', { name: /^(Save Notes|Saving…)$/ }),
    idleName: 'Save Notes',
    fill: () => new SessionNoteForm(page).fill(values),
    async expectFilled() {
      await expect(dialog.getByLabel('Subjective', { exact: true })).toHaveValue(values.subjective)
      await expect(dialog.getByLabel('Objective', { exact: true })).toHaveValue(values.objective)
      await expect(dialog.getByLabel('Assessment', { exact: true })).toHaveValue(values.assessment)
      await expect(dialog.getByLabel('Plan', { exact: true })).toHaveValue(values.plan)
      await expect(dialog.getByLabel('Exercises Prescribed', { exact: true })).toHaveValue(values.exercises)
    },
    rows: async () => (await factory.findSessionNotes(appointment.id)).length,
    async expectSaved() {
      await expect(toastRegion(page).getByText('Notes saved', { exact: true })).toBeVisible()
      await expect(dialog).toBeHidden()
      await expect(page.getByText(values.subjective, { exact: true })).toBeVisible()
    },
  }
}

async function reminderFlow(page: Page, factory: E2EFactory): Promise<OpenFlow> {
  const date = clinicDate(178)
  const values = {
    title: factory.uniqueName('reminder'),
    name: factory.uniqueName('reminder-contact'),
    time: '10:40',
    phone: factory.uniqueMobile(),
    notes: factory.uniqueName('reminder-notes'),
  }
  factory.watchUiReminder(values.title)
  const path = `/schedule?date=${date}`
  const dialog = page.getByRole('dialog', { name: 'New reminder' })
  const openForm = async () => {
    await page.getByRole('button', { name: 'Add reminder', exact: true }).filter({ visible: true }).tap()
    await expect(dialog).toBeVisible()
  }
  await page.goto(path)
  await openForm()
  return {
    path,
    openForm,
    container: dialog,
    submit: dialog.getByRole('button', { name: /^(Save reminder|Saving…)$/ }),
    idleName: 'Save reminder',
    async fill() {
      await dialog.getByLabel('Name · Optional').fill(values.name)
      await dialog.getByLabel('What needs following up?').fill(values.title)
      await dialog.getByLabel('Time · Optional').fill(values.time)
      await dialog.getByText('Add phone or notes', { exact: true }).tap()
      await dialog.getByLabel('Phone · Optional').fill(values.phone)
      await dialog.getByLabel('Notes · Optional').fill(values.notes)
    },
    async expectFilled() {
      await expect(dialog.getByLabel('Name · Optional')).toHaveValue(values.name)
      await expect(dialog.getByLabel('What needs following up?')).toHaveValue(values.title)
      await expect(dialog.getByLabel('Date', { exact: true })).toHaveValue(date)
      await expect(dialog.getByLabel('Time · Optional')).toHaveValue(values.time)
      await expect(dialog.getByLabel('Phone · Optional')).toHaveValue(values.phone)
      await expect(dialog.getByLabel('Notes · Optional')).toHaveValue(values.notes)
    },
    rows: async () => (await factory.findReminders({ title: values.title })).length,
    async expectSaved() {
      await expect(dialog).toBeHidden()
      await expect(page.getByRole('button').filter({ hasText: values.title }).filter({ visible: true })).toBeVisible()
    },
  }
}

async function patientFlow(page: Page, factory: E2EFactory): Promise<OpenFlow> {
  const values = {
    name: factory.uniqueName('phone-patient'),
    phone: factory.uniqueMobile(),
    email: factory.uniqueEmail('phone-patient'),
    age: '37',
    address: factory.uniqueName('address'),
    medicalHistory: factory.uniqueName('history'),
    notes: factory.uniqueName('patient-notes'),
  }
  factory.watchUiPatient(values.name)
  const form = page.locator('form').filter({ has: page.getByLabel('Name *', { exact: true }) })
  const openForm = async () => { await expect(form).toBeVisible() }
  await page.goto('/patients/new')
  await openForm()
  return {
    path: '/patients/new',
    openForm,
    container: form,
    submit: form.getByRole('button', { name: /^(Add Patient|Saving…)$/ }),
    idleName: 'Add Patient',
    fill: () => new PatientForm(page).fill(values),
    async expectFilled() {
      await expect(page.getByLabel('Name *', { exact: true })).toHaveValue(values.name)
      await expect(page.getByLabel('Phone', { exact: true })).toHaveValue(values.phone)
      await expect(page.getByLabel('Email', { exact: true })).toHaveValue(values.email)
      await expect(page.getByLabel('Age (years)', { exact: true })).toHaveValue(values.age)
      await expect(page.getByLabel('Address', { exact: true })).toHaveValue(values.address)
      await expect(page.getByLabel('Medical History', { exact: true })).toHaveValue(values.medicalHistory)
      await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(values.notes)
    },
    rows: () => countRows('patients', 'name', values.name),
    async expectSaved() {
      await expect(page).toHaveURL(/\/patients$/)
      await expect(toastRegion(page).getByText('Patient added', { exact: true })).toBeVisible()
    },
  }
}

async function paymentFlow(page: Page, factory: E2EFactory): Promise<OpenFlow> {
  const patient = await factory.createPatient()
  const notes = factory.uniqueName('phone-payment')
  factory.watchUiPayment({ patientId: patient.id, notes })
  const dialog = page.getByRole('dialog', { name: 'New Billing Entry' })
  const trigger = page.getByRole('button', { name: 'New billing entry', exact: true })
  const openForm = async () => {
    // `?new=1` opens the dialog on load; once closed, the URL is cleaned and the button opens it.
    await expect(dialog.or(trigger).first()).toBeVisible()
    if (!(await dialog.isVisible())) await trigger.tap()
    await expect(dialog).toBeVisible()
  }
  await page.goto('/billing?new=1')
  await openForm()
  return {
    path: '/billing?new=1',
    openForm,
    container: dialog,
    submit: dialog.getByRole('button', { name: /^(Save Payment|Saving\.\.\.)$/ }),
    idleName: 'Save Payment',
    async fill() {
      await dialog.getByLabel('Patient *', { exact: true }).tap()
      await page.getByPlaceholder('Search patient…', { exact: true }).fill(patient.name as string)
      await page.getByRole('button', { name: patient.name as string, exact: true }).tap()
      await dialog.getByLabel('Amount Received *', { exact: true }).fill('640')
      await dialog.getByLabel('Payment Method *', { exact: true }).tap()
      await page.getByRole('option', { name: 'Cash', exact: true }).tap()
      await dialog.getByLabel('Notes', { exact: true }).fill(notes)
      // The outstanding-charges read (a server action) answers before the form is ready to save.
      await expect(dialog.getByText(/No sessions are awaiting regular payment/)).toBeVisible()
    },
    async expectFilled() {
      await expect(dialog.getByLabel('Patient *', { exact: true })).toContainText(patient.name as string)
      await expect(dialog.getByLabel('Amount Received *', { exact: true })).toHaveValue('640')
      await expect(dialog.getByLabel('Payment Method *', { exact: true })).toContainText('Cash')
      await expect(dialog.getByLabel('Notes', { exact: true })).toHaveValue(notes)
    },
    rows: async () => (await factory.findPayments({ patientId: patient.id })).filter((row) => row.notes === notes).length,
    async expectSaved() {
      await expect(dialog).toBeHidden()
      await expect(toastRegion(page).getByText('Payment recorded', { exact: true })).toBeVisible()
    },
  }
}

async function createLoginFlow(page: Page, factory: E2EFactory): Promise<OpenFlow> {
  const values = { name: factory.uniqueName('phone-invitee'), phone: factory.uniqueMobile(), email: factory.uniqueEmail('phone-invitee') }
  factory.watchUiInvite(values.email)
  const sheet = page.getByRole('dialog', { name: 'Invite User' })
  const openForm = async () => {
    await expect(page.getByRole('heading', { name: 'Settings', exact: true }).filter({ visible: true })).toBeVisible()
    await new SettingsView(page).openSection('Invite User')
  }
  await page.goto('/settings')
  await openForm()
  return {
    path: '/settings',
    openForm,
    container: sheet,
    submit: sheet.getByRole('button', { name: /^(Create Login|Creating login…)$/ }),
    idleName: 'Create Login',
    async fill() {
      await sheet.getByLabel('Invitee name', { exact: true }).fill(values.name)
      await sheet.getByLabel(/^Mobile number/).fill(values.phone)
      await sheet.getByLabel('Invite email', { exact: true }).fill(values.email)
    },
    async expectFilled() {
      await expect(sheet.getByLabel('Invitee name', { exact: true })).toHaveValue(values.name)
      await expect(sheet.getByLabel(/^Mobile number/)).toHaveValue(values.phone)
      await expect(sheet.getByLabel('Invite email', { exact: true })).toHaveValue(values.email)
    },
    rows: () => countRows('user_invites', 'mobile_number', values.phone),
    async expectSaved() {
      const issued = page.getByRole('dialog', { name: 'Temporary password issued' })
      await expect(issued.getByTestId('temp-password')).toBeVisible()
      await issued.getByRole('button', { name: 'Done', exact: true }).tap()
      await expect(issued).toBeHidden()
    },
  }
}

export const FLOWS: Record<FlowId, Flow> = {
  'book-schedule': { id: 'book-schedule', title: 'book an appointment from the schedule', transport: 'booking-api', open: (page, factory) => bookingFlow(page, factory, 'schedule') },
  'book-dashboard': { id: 'book-dashboard', title: 'book an appointment from the dashboard', transport: 'booking-api', open: (page, factory) => bookingFlow(page, factory, 'dashboard') },
  'session-notes': { id: 'session-notes', title: 'save session notes', transport: 'server-action', open: sessionNotesFlow },
  reminder: { id: 'reminder', title: 'add a reminder', transport: 'server-action', open: reminderFlow },
  patient: { id: 'patient', title: 'add a patient', transport: 'supabase', open: patientFlow },
  payment: { id: 'payment', title: 'record a payment', transport: 'server-action', adminOnly: true, open: paymentFlow },
  'create-login': { id: 'create-login', title: 'create a login', transport: 'server-action', adminOnly: true, open: createLoginFlow },
}

/** Open a scheduled appointment's detail page, for the status-change flow. */
export async function openStatusFlow(page: Page, factory: E2EFactory) {
  const patient = await factory.createPatient()
  const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(63), time: '10:25' })
  await page.goto(`/schedule/${appointment.id}`)
  const trigger = page.getByRole('combobox').filter({ hasText: /^(Scheduled|Completed|Cancelled)$/ })
  await expect(trigger).toHaveText('Scheduled')
  return {
    trigger,
    async choose(status: 'Completed' | 'Scheduled') {
      await trigger.tap()
      await page.getByRole('option', { name: status, exact: true }).tap()
    },
    status: async () => (await factory.findAppointments({ patientId: patient.id }))[0]?.status,
  }
}

export { escapeRegExp }
