// Deleting a patient is an admin-only feature. Staff must not see the Delete control on the
// patient detail page (desktop or mobile header).

import { attachErrorGuards } from '../support/assertions'
import { test, expect } from '../support/factories'

test('staff cannot see the delete-patient control on patient detail', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()

  await page.goto(`/patients/${patient.id}`)

  // The Edit control is present for everyone; the Delete control is admin-only.
  await expect(page.getByRole('link', { name: 'Edit', exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)

  await guards.assertClean()
})
