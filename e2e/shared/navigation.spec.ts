import { test } from '@playwright/test'

import { gotoSuccessfulRoute } from '../support/assertions'
import { assertResponsiveClinicNavigation, navigateWithClinicNavigation } from '../support/nav'
import { pageRoutesFor } from '../support/route-manifest'

const dashboardRoute = pageRoutesFor('shared').find((route) => route.pattern === '/')!.cases[0]

test('shows role-appropriate responsive navigation and navigates accessibly', async ({ page }, testInfo) => {
  const role = testInfo.project.name.startsWith('admin-') ? 'admin' : 'staff'

  await gotoSuccessfulRoute(page, dashboardRoute)
  await assertResponsiveClinicNavigation(page, role)
  await navigateWithClinicNavigation(page, 'Patients', '/patients')
})
