// What a thumb can do on a phone screen (plan 5.7: M-9..M-13): a double tap saves once, every
// submit and error message is reachable above the bottom navigation, nothing scrolls sideways,
// number fields open a number keyboard, and the phone's own call and share sheets are used right.
//
// Desktop projects skip this whole file (the beforeEach below): it is about the phone app.
// M-9 also runs on `mobile-ios` (iPhone, WebKit) through the @ios tag.

import type { Locator, Page } from '@playwright/test'

import { AppointmentForm } from '../pages/appointment-form'
import { expectNoLeakedNulls, gotoSuccessfulRoute } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect, type E2EFactory } from '../support/factories'
import { SettingsView } from '../pages/settings-view'
import {
  IOS_TAG,
  PHONE_VIEWPORT,
  SMALL_PHONE_VIEWPORT,
  expectInViewport,
  expectNoHorizontalOverflow,
  projectRole,
  stubShare,
  tapTwice,
} from '../support/mobile'
import { pageRoutesFor } from '../support/route-manifest'
import { FLOWS, phoneGuards, phoneSkipReason, toastRegion, type FlowId } from './mobile-flows'

test.use({ serviceWorkers: 'block' })

test.beforeEach(({}, testInfo) => {
  const reason = phoneSkipReason(testInfo)
  test.skip(reason !== null, reason ?? '')
})

// ---------------------------------------------------------------------------------------------
// M-9 Double tap
// ---------------------------------------------------------------------------------------------

/** Flows whose double tap is a known bug, with the bug id. */
const DOUBLE_TAP_BUGS: Partial<Record<FlowId, string>> = {}

for (const flowId of ['book-schedule', 'book-dashboard', 'session-notes', 'reminder', 'patient', 'payment'] as const satisfies readonly FlowId[]) {
  const flow = FLOWS[flowId]
  test(`M-9 a double tap to ${flow.title} saves exactly once`, { tag: IOS_TAG }, async ({ page, factory }, testInfo) => {
    const reason = phoneSkipReason(testInfo, flow)
    test.skip(reason !== null, reason ?? '')
    const bug = DOUBLE_TAP_BUGS[flowId]
    if (bug) test.fail(true, bug)
    const guards = phoneGuards(page)
    const open = await flow.open(page, factory)
    await open.fill()

    await tapTwice(open.submit)
    await open.expectSaved()
    await expect.poll(() => open.rows()).toBeGreaterThan(0)
    // Let a second request, if one went out, land before counting.
    await page.waitForLoadState('networkidle')
    expect(await open.rows()).toBe(1)
    await guards.assertClean()
  })
}

// ---------------------------------------------------------------------------------------------
// M-10 Reachability of every submit and validation message
// ---------------------------------------------------------------------------------------------

type OpenSurface = {
  submit: Locator
  /** Makes the form show a validation message and returns it (absent: the form has none). */
  invalid?: () => Promise<Locator>
}

type Surface = {
  name: string
  adminOnly?: boolean
  open(page: Page, factory: E2EFactory): Promise<OpenSurface>
}

async function openSettingsSheet(page: Page, title: string) {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true }).filter({ visible: true })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(`^${title}`) }).tap()
  const sheet = page.getByRole('dialog', { name: title })
  await expect(sheet).toBeVisible()
  return sheet
}

const SURFACES: readonly Surface[] = [
  {
    name: 'appointment form with an inline new patient',
    async open(page, factory) {
      const type = await factory.findAppointmentType(true)
      await page.goto(`/schedule?date=${clinicDate(179)}`)
      await page.getByRole('button', { name: /^New appointment$/i }).filter({ visible: true }).tap()
      const dialog = page.getByRole('dialog', { name: 'New Appointment', exact: true })
      const name = factory.uniqueName('reach-inline-patient')
      factory.watchUiPatient(name)
      await new AppointmentForm(page, type.name).fill({
        patientName: name, date: clinicDate(179), time: '12:10', newPatient: { phone: factory.uniqueMobile(), age: '130' },
      })
      await expect(dialog.getByLabel('Phone *', { exact: true })).toBeVisible()
      const submit = dialog.getByRole('button', { name: 'Book Appointment', exact: true })
      return {
        submit,
        async invalid() {
          await submit.tap()
          return toastRegion(page).getByText('Check the age', { exact: true })
        },
      }
    },
  },
  {
    name: 'session notes',
    async open(page, factory) {
      const patient = await factory.createPatient()
      const appointment = await factory.createAppointment({ patientId: patient.id, date: clinicDate(-48), status: 'completed' })
      await page.goto(`/schedule/${appointment.id}`)
      await page.getByRole('button', { name: 'Add Notes', exact: true }).tap()
      const dialog = page.getByRole('dialog', { name: 'Session Notes (SOAP)' })
      return { submit: dialog.getByRole('button', { name: 'Save Notes', exact: true }) }
    },
  },
  {
    name: 'reminder',
    async open(page, factory) {
      await page.goto(`/schedule?date=${clinicDate(179)}`)
      await page.getByRole('button', { name: 'Add reminder', exact: true }).filter({ visible: true }).tap()
      const dialog = page.getByRole('dialog', { name: 'New reminder' })
      await dialog.getByText('Add phone or notes', { exact: true }).tap()
      const submit = dialog.getByRole('button', { name: 'Save reminder', exact: true })
      return {
        submit,
        async invalid() {
          await dialog.getByRole('button', { name: 'Existing patient', exact: true }).tap()
          await dialog.getByLabel('What needs following up?').fill(factory.uniqueName('reach-reminder'))
          await submit.tap()
          return dialog.getByRole('alert').filter({ hasText: 'Choose a patient, or switch to name only.' })
        },
      }
    },
  },
  {
    name: 'patient form',
    async open(page, factory) {
      await page.goto('/patients/new')
      const submit = page.getByRole('button', { name: 'Add Patient', exact: true })
      return {
        submit,
        async invalid() {
          const name = factory.uniqueName('reach-patient')
          factory.watchUiPatient(name)
          await page.getByLabel('Name *', { exact: true }).fill(name)
          await page.getByLabel('Age (years)', { exact: true }).fill('130')
          await submit.tap()
          return page.getByRole('alert').filter({ hasText: 'Age must be a whole number between 0 and 120.' })
        },
      }
    },
  },
  {
    name: 'treatment plan',
    async open(page, factory) {
      const patient = await factory.createPatient()
      await page.goto(`/patients/${patient.id}`)
      await page.getByRole('tab', { name: 'Plans', exact: true }).tap()
      await page.getByRole('button', { name: 'Add Plan', exact: true }).tap()
      const dialog = page.getByRole('dialog', { name: 'New Treatment Plan' })
      return { submit: dialog.getByRole('button', { name: 'Create Plan', exact: true }) }
    },
  },
  {
    name: 'billing entry: payment',
    adminOnly: true,
    async open(page) {
      await page.goto('/billing?new=1')
      const dialog = page.getByRole('dialog', { name: 'New Billing Entry' })
      return { submit: dialog.getByRole('button', { name: 'Save Payment', exact: true }) }
    },
  },
  {
    name: 'billing entry: package',
    adminOnly: true,
    async open(page) {
      await page.goto('/billing?new=1')
      const dialog = page.getByRole('dialog', { name: 'New Billing Entry' })
      await dialog.getByRole('button', { name: /Create package/ }).tap()
      return { submit: dialog.getByRole('button', { name: 'Save Package', exact: true }) }
    },
  },
  {
    name: 'refund',
    adminOnly: true,
    async open(page, factory) {
      const patient = await factory.createPatient()
      await factory.createPayment({ patientId: patient.id, amount: 750, date: clinicDate() })
      await page.goto('/billing?tab=payments')
      await page.getByRole('button', { name: `Refund payment for ${patient.name} · ₹750`, exact: true }).filter({ visible: true }).tap()
      const dialog = page.getByRole('alertdialog', { name: 'Record refund' })
      return { submit: dialog.getByRole('button', { name: 'Save audited change', exact: true }) }
    },
  },
  {
    name: 'invite',
    adminOnly: true,
    async open(page, factory) {
      const sheet = await openSettingsSheet(page, 'Invite User')
      const submit = sheet.getByRole('button', { name: 'Create Login', exact: true })
      return {
        submit,
        async invalid() {
          await sheet.getByLabel('Invitee name', { exact: true }).fill(factory.uniqueName('reach-invitee'))
          await sheet.getByLabel(/^Mobile number/).fill('12345')
          await submit.tap()
          return toastRegion(page).getByText('Login not created', { exact: true })
        },
      }
    },
  },
  {
    name: 'temporary staff',
    adminOnly: true,
    async open(page) {
      const sheet = await openSettingsSheet(page, 'Temporary Staff')
      return { submit: sheet.getByRole('button', { name: 'Add Temporary Staff', exact: true }) }
    },
  },
  {
    name: 'change password',
    async open(page) {
      const sheet = await openSettingsSheet(page, 'Your Account')
      const submit = sheet.getByRole('button', { name: 'Change Password', exact: true })
      return {
        submit,
        async invalid() {
          // Never a valid change: this must not touch the shared account's password.
          await sheet.getByLabel('Current password', { exact: true }).fill('not-the-password')
          await sheet.getByLabel('New password', { exact: true }).fill('short')
          await sheet.getByLabel('Confirm new password', { exact: true }).fill('different')
          await submit.tap()
          return sheet.locator('p.text-destructive').first()
        },
      }
    },
  },
]

for (const viewport of [PHONE_VIEWPORT, SMALL_PHONE_VIEWPORT]) {
  for (const surface of SURFACES) {
    test(`M-10 at ${viewport.width}×${viewport.height}, the ${surface.name} submit and its error are reachable above the bottom navigation`, async ({ page, factory }, testInfo) => {
      test.skip(surface.adminOnly === true && projectRole(testInfo) !== 'admin', 'admin-only surface')
      const guards = phoneGuards(page)
      await page.setViewportSize(viewport)
      const open = await surface.open(page, factory)
      await expectInViewport(open.submit)
      if (open.invalid) {
        const message = await open.invalid()
        await expectInViewport(message)
        await expectInViewport(open.submit)
      }
      await expectNoHorizontalOverflow(page)
      await guards.assertClean()
    })
  }
}

// ---------------------------------------------------------------------------------------------
// M-11 Nothing scrolls sideways
// ---------------------------------------------------------------------------------------------

const OVERFLOW_ROUTES = [
  ...pageRoutesFor('shared').flatMap((declaration) => declaration.cases.map((route) => ({ route, admin: false }))),
  ...pageRoutesFor('admin').flatMap((declaration) => declaration.cases.map((route) => ({ route, admin: true }))),
].filter(({ route }) => route.expected.kind === 'render')

for (const { route, admin } of OVERFLOW_ROUTES) {
  test(`M-11 ${route.requestPath} does not scroll sideways on a phone`, async ({ page }, testInfo) => {
    test.skip(admin && projectRole(testInfo) !== 'admin', 'admin-only route')
    await gotoSuccessfulRoute(page, route)
    await expectNoHorizontalOverflow(page)
  })
}

test('M-11 a 60-character unbroken name and a long diagnosis do not make any screen scroll sideways', async ({ page, factory }) => {
  const guards = phoneGuards(page)
  const unbroken = `Unbroken${factory.token.replace(/[^A-Za-z0-9]/g, '')}`.padEnd(60, 'x').slice(0, 60)
  const patient = await factory.createPatient({ name: `E2E ${unbroken}`, address: `${unbroken}Road`, medical_history: unbroken })
  await factory.createTreatmentPlan({
    patientId: patient.id,
    diagnosis: `Chronic ${'lumbosacralradiculopathywithcompensatorygaitchange'.repeat(2)} after ${unbroken}`,
    goals: unbroken,
  })
  const date = clinicDate(164)
  const appointment = await factory.createAppointment({ patientId: patient.id, date, time: '13:05', notes: unbroken })

  const screens: { path: string; then?: (page: Page) => Promise<void> }[] = [
    { path: `/patients/${patient.id}` },
    { path: `/patients/${patient.id}`, then: (p) => p.getByRole('tab', { name: 'Plans', exact: true }).tap() },
    { path: `/patients/${patient.id}/edit` },
    { path: `/schedule/${appointment.id}` },
    { path: `/schedule?date=${date}` },
    { path: '/patients', then: async (p) => { await p.getByPlaceholder(/search/i).filter({ visible: true }).first().fill(unbroken) } },
  ]
  for (const screen of screens) {
    await page.goto(screen.path)
    await expect(page.getByText(new RegExp(unbroken)).filter({ visible: true }).first()).toBeVisible()
    if (screen.then) await screen.then(page)
    await expect(page.getByText(new RegExp(unbroken)).filter({ visible: true }).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await expectNoLeakedNulls(page)
  }
  await guards.assertClean()
})

// ---------------------------------------------------------------------------------------------
// M-12 Phone-friendly keyboards
// ---------------------------------------------------------------------------------------------

type KeyboardKind = 'phone' | 'number'

type KeyboardField = {
  surface: string
  label: string
  kind: KeyboardKind
  adminOnly?: boolean
  open(page: Page, factory: E2EFactory): Promise<Locator>
}

const KEYBOARD_FIELDS: readonly KeyboardField[] = [
  { surface: 'patient form', label: 'Phone', kind: 'phone', open: async (page) => { await page.goto('/patients/new'); return page.getByLabel('Phone', { exact: true }) } },
  { surface: 'patient form', label: 'Age (years)', kind: 'number', open: async (page) => { await page.goto('/patients/new'); return page.getByLabel('Age (years)', { exact: true }) } },
  ...(['Phone *', 'Age (years)', 'Duration (min)', 'Session Fee (₹)', 'Total sessions *'] as const).map((label): KeyboardField => ({
    surface: 'appointment form',
    label,
    kind: label === 'Phone *' ? 'phone' : 'number',
    adminOnly: label === 'Session Fee (₹)',
    async open(page, factory) {
      await page.goto(`/schedule?date=${clinicDate(179)}`)
      await page.getByRole('button', { name: /^New appointment$/i }).filter({ visible: true }).tap()
      const dialog = page.getByRole('dialog', { name: 'New Appointment', exact: true })
      if (label === 'Phone *' || label === 'Age (years)') {
        await dialog.getByLabel('Patient *', { exact: true }).fill(factory.uniqueName('keyboard'))
        await dialog.getByRole('button', { name: /^Create new patient: / }).tap()
      }
      if (label === 'Total sessions *') await dialog.getByRole('switch', { name: 'Toggle repeat appointment' }).tap()
      return dialog.getByLabel(label, { exact: true })
    },
  })),
  {
    surface: 'reminder', label: 'Phone · Optional', kind: 'phone',
    async open(page) {
      await page.goto(`/schedule?date=${clinicDate(179)}`)
      await page.getByRole('button', { name: 'Add reminder', exact: true }).filter({ visible: true }).tap()
      const dialog = page.getByRole('dialog', { name: 'New reminder' })
      await dialog.getByText('Add phone or notes', { exact: true }).tap()
      return dialog.getByLabel('Phone · Optional')
    },
  },
  ...(['Amount Received *', 'Sessions *', 'Per Session *'] as const).map((label): KeyboardField => ({
    surface: 'billing entry', label, kind: 'number', adminOnly: true,
    async open(page) {
      await page.goto('/billing?new=1')
      const dialog = page.getByRole('dialog', { name: 'New Billing Entry' })
      if (label !== 'Amount Received *') await dialog.getByRole('button', { name: /Create package/ }).tap()
      return dialog.getByLabel(label, { exact: true })
    },
  })),
  {
    surface: 'refund', label: 'Amount *', kind: 'number', adminOnly: true,
    async open(page, factory) {
      const patient = await factory.createPatient()
      await factory.createPayment({ patientId: patient.id, amount: 750, date: clinicDate() })
      await page.goto('/billing?tab=payments')
      await page.getByRole('button', { name: `Refund payment for ${patient.name} · ₹750`, exact: true }).filter({ visible: true }).tap()
      return page.getByRole('alertdialog', { name: 'Record refund' }).getByLabel('Amount *', { exact: true })
    },
  },
  {
    surface: 'invite', label: 'Mobile number', kind: 'phone', adminOnly: true,
    async open(page) {
      await page.goto('/settings')
      await new SettingsView(page).openSection('Invite User')
      return page.getByRole('dialog', { name: 'Invite User' }).getByLabel(/^Mobile number/)
    },
  },
  {
    surface: 'temporary staff', label: 'Phone *', kind: 'phone', adminOnly: true,
    async open(page) {
      await page.goto('/settings')
      await new SettingsView(page).openSection('Temporary Staff')
      return page.getByRole('dialog', { name: 'Temporary Staff' }).getByLabel('Phone *', { exact: true })
    },
  },
  ...(['Clinic Visit Fee (₹)', 'Home Visit Fee (₹)'] as const).map((label): KeyboardField => ({
    surface: 'session fees', label, kind: 'number', adminOnly: true,
    async open(page) {
      await page.goto('/settings')
      await new SettingsView(page).openSection('Session Fees')
      return page.getByRole('dialog', { name: 'Session Fees' }).getByLabel(label, { exact: true })
    },
  })),
]

/** Phone fields must open the dial pad; number fields a number pad (type=number or inputmode). */
function keyboardProblem(kind: KeyboardKind, attributes: { type: string; inputMode: string }) {
  if (kind === 'phone') return attributes.type === 'tel' || attributes.inputMode === 'tel' ? null : 'opens the full text keyboard, not the dial pad'
  return attributes.type === 'number' || ['numeric', 'decimal'].includes(attributes.inputMode) ? null : 'opens the full text keyboard, not a number pad'
}

for (const field of KEYBOARD_FIELDS) {
  test(`M-12 ${field.surface} → ${field.label} opens the ${field.kind === 'phone' ? 'dial pad' : 'number pad'}`, async ({ page, factory }, testInfo) => {
    test.skip(field.adminOnly === true && projectRole(testInfo) !== 'admin', 'admin-only field')
    const guards = phoneGuards(page)
    const input = await field.open(page, factory)
    await expect(input).toBeVisible()
    const attributes = await input.evaluate((element) => ({
      type: (element.getAttribute('type') ?? 'text').toLowerCase(),
      inputMode: (element.getAttribute('inputmode') ?? '').toLowerCase(),
    }))
    expect(keyboardProblem(field.kind, attributes), `${field.surface} → ${field.label}: ${JSON.stringify(attributes)}`).toBeNull()
    await guards.assertClean()
  })
}

// ---------------------------------------------------------------------------------------------
// M-13 Calling and sharing
// ---------------------------------------------------------------------------------------------

test('M-13 a patient with a phone gets a valid Call link; one without gets none', async ({ page, factory }) => {
  const guards = phoneGuards(page)
  const withPhone = await factory.createPatient({ phone: factory.uniqueMobile() })
  const withoutPhone = await factory.createPatient({ phone: null })
  const appointment = await factory.createAppointment({ patientId: withPhone.id, date: clinicDate(165), time: '15:15' })
  const noPhoneAppointment = await factory.createAppointment({ patientId: withoutPhone.id, date: clinicDate(165), time: '15:45' })

  for (const path of [`/patients/${withPhone.id}`, `/schedule/${appointment.id}`]) {
    await page.goto(path)
    const call = page.getByRole('link', { name: `Call ${withPhone.name}`, exact: true }).filter({ visible: true })
    await expectInViewport(call)
    await expect(call).toHaveAttribute('href', `tel:${withPhone.phone}`)
    expect(withPhone.phone).toMatch(/^\d{10}$/)
    await expectNoLeakedNulls(page)
  }
  for (const path of [`/patients/${withoutPhone.id}`, `/schedule/${noPhoneAppointment.id}`]) {
    await page.goto(path)
    await expect(page.getByText(withoutPhone.name as string, { exact: true }).filter({ visible: true }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: `Call ${withoutPhone.name}`, exact: true })).toHaveCount(0)
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(0)
    await expect(page.getByText('No phone number', { exact: true }).filter({ visible: true }).first()).toBeVisible()
    await expectNoLeakedNulls(page)
  }
  await guards.assertClean()
})

async function openPdfDialog(page: Page, factory: E2EFactory) {
  const patient = await factory.createPatient()
  await factory.createAppointment({ patientId: patient.id, date: clinicDate(-4), time: '09:00', status: 'completed', fee: 800 })
  await page.goto(`/billing/payment-due/${patient.id}`)
  await page.getByRole('button', { name: 'Share payment PDF' }).filter({ visible: true }).tap()
  const dialog = page.getByRole('dialog', { name: 'Generate payment PDF' })
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Generate PDF', exact: true }).tap()
  await download
  await expect(dialog.getByText('PDF downloaded and ready to share.', { exact: true })).toBeVisible()
  return { dialog, share: dialog.getByRole('button', { name: 'Share PDF', exact: true }) }
}

test('M-13 the payment PDF is offered to the share sheet as a PDF file', async ({ page, factory }, testInfo) => {
  test.skip(projectRole(testInfo) !== 'admin', 'billing is admin-only')
  const guards = phoneGuards(page)
  const shares = await stubShare(page)
  const { dialog, share } = await openPdfDialog(page, factory)
  await expectInViewport(share)
  await share.tap()
  await expect.poll(async () => (await shares.calls()).length).toBe(1)
  const [call] = await shares.calls()
  expect(call.files).toHaveLength(1)
  expect(call.files[0]).toMatchObject({ type: 'application/pdf' })
  expect(call.files[0].name).toMatch(/\.pdf$/)
  expect(call.files[0].size).toBeGreaterThan(0)
  await expect(share).toBeEnabled()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await guards.assertClean()
})

test('M-13 dismissing the share sheet is not an error and leaves Share PDF ready', async ({ page, factory }, testInfo) => {
  test.skip(projectRole(testInfo) !== 'admin', 'billing is admin-only')
  const guards = phoneGuards(page)
  const shares = await stubShare(page, { reject: true })
  const { dialog, share } = await openPdfDialog(page, factory)
  await share.tap()
  await expect.poll(async () => (await shares.calls()).length).toBe(1)
  await expect(share).toBeEnabled()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog.getByText('PDF downloaded and ready to share.', { exact: true })).toBeVisible()
  await guards.assertClean()
})
