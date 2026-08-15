import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { addDays, format, parseISO, startOfWeek } from 'date-fns'

import { attachErrorGuards } from '../support/assertions'
import { clinicDate } from '../support/clinic-date'
import { SEED } from '../support/ids'

function isMobileProject(testInfo: TestInfo) {
  return testInfo.project.name.endsWith('-mobile')
}

async function assertMdBreakpoint(page: Page, testInfo: TestInfo) {
  const mobile = isMobileProject(testInfo)
  const viewport = page.viewportSize()

  expect(viewport, 'responsive projects must define a viewport').not.toBeNull()
  expect(viewport!.width < 768).toBe(mobile)
  expect(await page.evaluate(() => window.matchMedia('(min-width: 768px)').matches)).toBe(!mobile)
}

function fullDateLabel(date: string) {
  return new Intl.DateTimeFormat('en', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00.000Z`))
}

test('schedule switches between the mobile rolling rail and desktop calendar layout', async ({ page }, testInfo) => {
  const guards = attachErrorGuards(page)
  const selectedDate = clinicDate()

  await page.goto(`/schedule?date=${selectedDate}`)
  await assertMdBreakpoint(page, testInfo)

  const mobile = isMobileProject(testInfo)
  const rail = page.getByRole('region', {
    name: 'Schedule dates',
    exact: true,
    includeHidden: true,
  })
  const swipeInstruction = page.getByText('Swipe the dates to change week', { exact: true })
  const dayToggle = page.getByRole('button', { name: 'Day', exact: true, includeHidden: true })
  const weekToggle = page.getByRole('button', { name: 'Week', exact: true, includeHidden: true })
  const desktopFilters = page.getByRole('heading', {
    name: 'Filters',
    exact: true,
    includeHidden: true,
  })
  const mobileFilter = page.getByRole('button', { name: 'All', exact: true, includeHidden: true })
  const timelineAppointment = page.getByRole('link', { name: /Asha Rao/ }).filter({ visible: true })
  const timelineWeekday = page.getByText(format(parseISO(selectedDate), 'EEEE'), { exact: true })
  const timelineDate = page.getByText(format(parseISO(selectedDate), 'MMM d, yyyy'), { exact: true })

  if (!mobile) {
    await expect(rail).toBeHidden()
    await expect(swipeInstruction).toBeHidden()
    await expect(dayToggle).toBeVisible()
    await expect(weekToggle).toBeVisible()
    await expect(desktopFilters).toBeVisible()
    await expect(mobileFilter).toBeHidden()
    const weekStart = startOfWeek(parseISO(selectedDate), { weekStartsOn: 1 })
    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const day = addDays(weekStart, dayOffset)
      // The desktop chips carry the same spoken name as the mobile rail: `<full date>, N appointments`.
      await expect(page.getByRole('button', {
        name: new RegExp(`^${fullDateLabel(format(day, 'yyyy-MM-dd'))}, `),
      }).filter({ visible: true })).toBeVisible()
    }
    await expect(timelineWeekday).toBeVisible()
    await expect(timelineDate).toBeVisible()
    await expect(timelineAppointment).toContainText('11:59 PM')
    await expect(timelineAppointment).toContainText('Asha Rao')
    await expect(timelineAppointment).toContainText('Clinic')

    const filtersElement = await desktopFilters.elementHandle()
    expect(filtersElement).not.toBeNull()
    const dayLayout = await timelineAppointment.evaluate((appointment, filters) => {
      let candidate: HTMLElement | null = appointment.parentElement
      while (candidate && !candidate.contains(filters as Node)) candidate = candidate.parentElement
      if (!candidate) throw new Error('Schedule timeline/sidebar layout was not found')
      const style = getComputedStyle(candidate)
      return {
        display: style.display,
        columns: style.gridTemplateColumns.split(' ').length,
      }
    }, filtersElement)
    expect(dayLayout).toEqual({ display: 'grid', columns: 2 })
    const appointmentBox = await timelineAppointment.boundingBox()
    const filtersBox = await desktopFilters.boundingBox()
    expect(appointmentBox).not.toBeNull()
    expect(filtersBox).not.toBeNull()
    expect(appointmentBox!.x + appointmentBox!.width).toBeLessThanOrEqual(filtersBox!.x)
    await guards.assertClean()
    return
  }

  await expect(rail).toBeVisible()
  await expect(swipeInstruction).toBeVisible()
  await expect(dayToggle).toBeHidden()
  await expect(weekToggle).toBeHidden()
  await expect(desktopFilters).toBeHidden()
  await expect(mobileFilter).toBeVisible()
  await expect(timelineWeekday).toBeVisible()
  await expect(timelineDate).toBeVisible()
  await expect(timelineAppointment).toContainText('11:59 PM')
  await expect(timelineAppointment).toContainText('Asha Rao')
  await expect(timelineAppointment).toContainText('Clinic')
  const timelineBox = await timelineAppointment.boundingBox()
  expect(timelineBox).not.toBeNull()
  expect(timelineBox!.x).toBeGreaterThanOrEqual(0)
  expect(timelineBox!.x + timelineBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width)

  const selected = rail.getByRole('button', {
    name: new RegExp(`^${fullDateLabel(selectedDate)},`),
  })
  await expect(selected).toHaveCount(1)
  await expect(selected).toHaveAttribute('aria-current', 'date')
  const railBox = await rail.boundingBox()
  const selectedBox = await selected.boundingBox()
  expect(railBox).not.toBeNull()
  expect(selectedBox).not.toBeNull()
  expect(selectedBox!.x).toBeGreaterThanOrEqual(railBox!.x)
  expect(selectedBox!.x + selectedBox!.width).toBeLessThanOrEqual(railBox!.x + railBox!.width)
  expect(Math.abs(
    (selectedBox!.x + selectedBox!.width / 2) - (railBox!.x + railBox!.width / 2),
  )).toBeLessThan(12)

  const initialScrollLeft = await rail.evaluate((element) => element.scrollLeft)
  expect(initialScrollLeft).toBeGreaterThan(0)
  await rail.hover()
  await page.mouse.wheel(240, 0)
  await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(initialScrollLeft)

  const targetDate = clinicDate(5)
  const target = rail.getByRole('button', {
    name: new RegExp(`^${fullDateLabel(targetDate)},`),
  })
  await target.click()
  await expect.poll(() => {
    const url = new URL(page.url())
    return `${url.pathname}${url.search}`
  }).toBe(`/schedule?date=${targetDate}`)
  const newlySelected = rail.getByRole('button', {
    name: new RegExp(`^${fullDateLabel(targetDate)},`),
  })
  await expect(newlySelected).toHaveAttribute('aria-current', 'date')
  await expect(selected).not.toHaveAttribute('aria-current', 'date')

  await page.getByRole('button', { name: 'Jump to date', exact: true }).click()
  const dateDialog = page.getByRole('dialog')
  await expect(dateDialog).toBeVisible()
  const dialogBox = await dateDialog.boundingBox()
  expect(dialogBox).not.toBeNull()
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0)
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.keyboard.press('Escape')
  await expect(dateDialog).toBeHidden()

  const newAppointmentTrigger = page.getByRole('button', {
    name: 'New Appointment',
    exact: true,
  })
  await newAppointmentTrigger.click()
  const appointmentDialog = page.getByRole('dialog', { name: 'New Appointment', exact: true })
  await expect(appointmentDialog).toBeVisible()
  await expect(appointmentDialog.getByRole('heading', {
    name: 'New Appointment',
    exact: true,
  })).toBeVisible()
  await expect(appointmentDialog.getByLabel('Patient *', { exact: true })).toBeVisible()
  await expect(appointmentDialog.getByLabel('Date *', { exact: true })).toHaveValue(targetDate)
  const appointmentDialogBox = await appointmentDialog.boundingBox()
  expect(appointmentDialogBox).not.toBeNull()
  expect(appointmentDialogBox!.x).toBeGreaterThanOrEqual(0)
  expect(appointmentDialogBox!.y).toBeGreaterThanOrEqual(0)
  expect(appointmentDialogBox!.x + appointmentDialogBox!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  )
  expect(appointmentDialogBox!.y + appointmentDialogBox!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  )
  await appointmentDialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(appointmentDialog).toBeHidden()

  await guards.assertClean()
})

test('patients use table rows on desktop and compact cards on mobile', async ({ page }, testInfo) => {
  const guards = attachErrorGuards(page)

  await page.goto('/patients')
  await assertMdBreakpoint(page, testInfo)

  const tablePatient = page.getByText('Patient', { exact: true })
  const tablePhone = page.getByText('Phone', { exact: true })
  const tableJoined = page.getByText('Joined', { exact: true })
  const desktopRow = page.getByRole('link', {
    name: /Asha Rao.*female.*9876500001/i,
    includeHidden: true,
  })
  const mobileCard = page.getByRole('link', {
    name: /Asha Rao.*9876500001.*female/i,
    includeHidden: true,
  })

  if (isMobileProject(testInfo)) {
    await expect(tablePatient).toBeHidden()
    await expect(tablePhone).toBeHidden()
    await expect(tableJoined).toBeHidden()
    await expect(desktopRow).toBeHidden()
    await expect(mobileCard).toBeVisible()
  } else {
    await expect(tablePatient).toBeVisible()
    await expect(tablePhone).toBeVisible()
    await expect(tableJoined).toBeVisible()
    await expect(desktopRow).toBeVisible()
    await expect(mobileCard).toBeHidden()
  }

  await guards.assertClean()
})

test('new and detail pages expose the breakpoint-appropriate header and Back affordance', async ({ page }, testInfo) => {
  const guards = attachErrorGuards(page)

  await page.goto('/schedule/new')
  await assertMdBreakpoint(page, testInfo)
  const newAppointmentBack = page.getByRole('button', { name: 'Go back', exact: true })
  await expect(newAppointmentBack).toBeVisible()
  if (isMobileProject(testInfo)) {
    expect(await newAppointmentBack.evaluate((back) => (
      getComputedStyle(back.parentElement!).position
    ))).toBe('sticky')
    await expect(page.getByRole('heading', { name: 'New Appointment', exact: true })).toBeHidden()
    await expect(page.getByText('New Appointment', { exact: true }).filter({ visible: true })).toBeVisible()
  } else {
    await expect(page.getByRole('heading', { name: 'New Appointment', exact: true })).toBeVisible()
  }

  await page.goto(`/schedule/${SEED.appointmentShared}`)
  await assertMdBreakpoint(page, testInfo)
  if (isMobileProject(testInfo)) {
    const appointmentBack = page.getByRole('button', { name: 'Go back', exact: true })
    await expect(appointmentBack).toBeVisible()
    expect(await appointmentBack.evaluate((back) => (
      getComputedStyle(back.parentElement!).position
    ))).toBe('sticky')
    await expect(page.getByRole('heading', { name: 'Appointment', exact: true })).toBeHidden()
    await expect(page.getByText('Appointment', { exact: true }).filter({ visible: true })).toBeVisible()
  } else {
    await expect(page.getByRole('heading', { name: 'Appointment', exact: true })).toBeVisible()
  }

  await guards.assertClean()
})
