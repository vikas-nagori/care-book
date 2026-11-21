// The app is used mostly as an installed phone app (iOS and Android). These cover what that
// means: date taps that don't wait on the server, a screen that catches up when the app is
// brought back, and a session that survives the app being killed.

import { attachErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { test, expect } from '../support/factories'

function fullDateLabel(date: string) {
  return new Intl.DateTimeFormat('en', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    .format(new Date(`${date}T00:00:00.000Z`))
}

test('a date tap inside the loaded weeks switches the day without a server round trip', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const patient = await factory.createPatient()
  const start = clinicDate(150), next = clinicDate(151)
  await factory.createAppointment({ patientId: patient.id, date: next, time: '09:30', status: 'scheduled' })

  await page.goto(`/schedule?date=${start}`)
  await expect(page.getByText(patient.name as string, { exact: true })).toHaveCount(0)
  const rscRequests: string[] = []
  // Only a fetch for a schedule date counts. Navigation link preloads (/patients, the bare
  // /schedule tab link, …) are unrelated background requests.
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.headers()['rsc'] === '1' && url.pathname === '/schedule' && url.searchParams.has('date')) rscRequests.push(request.url())
  })

  await page.getByRole('button', { name: new RegExp(`^${fullDateLabel(next)}, `) }).filter({ visible: true }).click()
  await expect(page).toHaveURL(new RegExp(`date=${next}`))
  await expect(page.getByText(patient.name as string, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  expect(rscRequests).toEqual([])

  // Back returns to the earlier day, still on the device.
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`date=${start}`))
  await expect(page.getByText(patient.name as string, { exact: true })).toHaveCount(0)
  await guards.assertClean()
})

test('bringing the app back after a while shows changes made meanwhile, without signing in again', async ({ page, factory }) => {
  const guards = attachErrorGuards(page)
  const date = clinicDate(155)
  await page.clock.install()
  await page.goto(`/schedule?date=${date}`)
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true }).filter({ visible: true })).toBeVisible()

  const setVisibility = (state: 'hidden' | 'visible') => page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)

  await setVisibility('hidden')
  // Someone else books while the phone is in a pocket.
  const patient = await factory.createPatient()
  await factory.createAppointment({ patientId: patient.id, date, time: '10:15', status: 'scheduled' })
  await page.clock.fastForward('02:00')
  await setVisibility('visible')

  await expect(page.getByText(patient.name as string, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page).not.toHaveURL(/\/login/)
  await guards.assertClean()
})

test('a cold start renews the session cookie for its full lifetime', async ({ page }) => {
  const response = await page.goto('/')
  expect(response).not.toBeNull()
  const setCookie = (await response!.headersArray())
    .filter(({ name }) => name.toLowerCase() === 'set-cookie')
    .map(({ value }) => value)
  const session = setCookie.filter((value) => /^sb-[^=]*-auth-token/.test(value))
  expect(session.length).toBeGreaterThan(0)
  for (const cookie of session) expect(cookie).toMatch(/Max-Age=34560000/i)
  await expect(page).not.toHaveURL(/\/login/)
})
