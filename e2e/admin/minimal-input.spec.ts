// Admin-only minimal-input coverage; see e2e/shared/minimal-input.spec.ts for the rationale.

import { BillingEntryForm } from '../pages/billing-entry-form'
import { SettingsView } from '../pages/settings-view'
import { attachErrorGuards, expectNoLeakedNulls } from '../support/assertions'
import { test, expect } from '../support/factories'
import { adminClient } from '../support/supabase-admin'

test('a payment recorded without notes renders in billing and on the patient', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient({ phone: null })

  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()
  await form.fillPaymentOnly({ patientName: patient.name as string, amount: '650', method: 'Cash' })
  await form.submit('payment')

  await expect.poll(async () => (await factory.findPayments({ patientId: patient.id })).length).toBe(1)
  const [payment] = await factory.findPayments({ patientId: patient.id })
  expect(payment).toMatchObject({ amount: 650, notes: null })

  await page.reload()
  await expectNoLeakedNulls(page)
  await page.goto(`/patients/${patient.id}`)
  await page.getByRole('tab', { name: 'Billing', exact: true }).click()
  await expect(page.getByText('₹650', { exact: false }).filter({ visible: true }).first()).toBeVisible()
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

test('temporary staff added without an email renders in settings', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const name = factory.uniqueName('no-email-temp-staff')
  const phone = factory.uniqueMobile()
  factory.watchUiExternalStaff({ name, phone })

  await page.goto('/settings')
  const settings = new SettingsView(page)
  await settings.addExternalStaff({ name, phone })
  expect(await factory.findExternalStaff({ name, phone })).toMatchObject({ email: null, status: 'active' })

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await settings.openSection('Temporary Staff')
  await expect(page.getByText(name, { exact: true }).filter({ visible: true })).toBeVisible()
  await expectNoLeakedNulls(page)
  await guards.assertClean()
})

// "Appointment Type *" is a Radix Select. Left untouched, its hidden native <select> must not
// quietly submit the first type: the package would then only cover that type's sessions.
test('a package cannot be saved until an appointment type is chosen', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient({ phone: null })
  const name = factory.uniqueName('typeless-package')
  factory.watchUiPackage({ patientId: patient.id, name })

  await page.goto('/billing')
  const form = new BillingEntryForm(page)
  await form.open()
  await page.getByRole('button', { name: /Package \+ payment/i }).click()
  await form.selectPatientByName(patient.name as string)
  await page.getByLabel('Package Name *', { exact: true }).fill(name)
  await page.getByLabel('Sessions *', { exact: true }).fill('4')
  await page.getByLabel('Per Session *', { exact: true }).fill('500')
  await page.getByRole('button', { name: 'Save Package', exact: true }).click()

  await expect(page.getByRole('dialog', { name: 'New Billing Entry' })).toBeVisible()
  await page.waitForTimeout(1_500)
  const { data, error } = await adminClient().from('packages').select('id, appointment_type_id').eq('patient_id', patient.id)
  expect(error).toBeNull()
  expect(data).toEqual([])
  await guards.assertClean()
})
