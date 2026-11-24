import { test } from '@playwright/test'

import { attachErrorGuards, gotoDeniedRoute } from '../support/assertions'

test('authenticated clinic users leave /login for the clinic dashboard', async ({ page }) => {
  await gotoDeniedRoute(page, {
    requestPath: '/login',
    expected: { kind: 'redirect', pathname: '/' },
    landmark: { kind: 'heading', name: 'Today' },
  })
})

test('non-allowlisted clinic users cannot enter the platform console', async ({ page }) => {
  await gotoDeniedRoute(page, {
    requestPath: '/platform',
    expected: { kind: 'redirect', pathname: '/' },
    landmark: { kind: 'heading', name: 'Today' },
  })
})

// PL-9: the platform sub-routes and the External Staff workspace are not for clinic admins or
// staff; each sends them to their own dashboard rather than rendering or erroring.
const FOREIGN_WORKSPACE_ROUTES = [
  '/platform/clinics',
  '/platform/users',
  '/platform/clinic-requests',
  '/external',
  '/external/patients',
  '/external/account',
] as const

for (const requestPath of FOREIGN_WORKSPACE_ROUTES) {
  test(`clinic users are sent home from ${requestPath}`, async ({ page }) => {
    const guards = attachErrorGuards(page)
    await gotoDeniedRoute(page, {
      requestPath,
      expected: { kind: 'redirect', pathname: '/' },
      landmark: { kind: 'heading', name: 'Today' },
    })
    await guards.assertClean()
  })
}
