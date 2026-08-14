import { test, expect, type Page, type TestInfo } from '@playwright/test'

import { attachErrorGuards } from '../support/assertions'
import { ADMIN } from '../support/accounts'
import { SEED } from '../support/ids'

function isMobileProject(testInfo: TestInfo) {
  return testInfo.project.name.endsWith('-mobile')
}

async function assertMdBreakpoint(page: Page, testInfo: TestInfo) {
  const mobile = isMobileProject(testInfo)
  expect(page.viewportSize()!.width < 768).toBe(mobile)
  expect(await page.evaluate(() => window.matchMedia('(min-width: 768px)').matches)).toBe(!mobile)
}

test('admin settings switch between persistent panels and focus-restoring mobile sheets', async ({ page }, testInfo) => {
  const guards = attachErrorGuards(page)

  await page.goto('/settings')
  await assertMdBreakpoint(page, testInfo)

  const sections = [
    {
      title: 'Your Account',
      triggerName: /^Your Account\s*Profile & logout$/,
      assertContent: async () => {
        await expect(page.getByRole('dialog', { name: 'Your Account' }).getByRole('button', {
          name: 'Logout',
          exact: true,
        })).toBeVisible()
      },
    },
    {
      title: 'Appointment Types',
      triggerName: /^Appointment Types\s*\d+ types?$/,
      assertContent: async () => {
        await expect(page.getByRole('dialog', { name: 'Appointment Types' }).getByRole('button', {
          name: 'Add appointment type',
          exact: true,
        })).toBeVisible()
      },
    },
    {
      title: 'Package Templates',
      triggerName: /^Package Templates\s*\d+ templates?$/,
      assertContent: async () => {
        await expect(page.getByRole('dialog', { name: 'Package Templates' }).getByRole('button', {
          name: 'Add package template',
          exact: true,
        })).toBeVisible()
      },
    },
    {
      title: 'External Staff',
      triggerName: /^External Staff\s*\d+ (?:person|people)$/,
      assertContent: async () => {
        await expect(page.getByRole('dialog', { name: 'External Staff' }).getByRole('button', {
          name: 'Add External Staff',
          exact: true,
        })).toBeVisible()
      },
    },
    {
      title: 'Invites',
      triggerName: /^Invites\s*\d+ sent$/,
      assertContent: async () => {
        const dialog = page.getByRole('dialog', { name: 'Invites' })
        await expect(dialog.getByText(/No invites have been sent yet\.|@carebook\.test/).first()).toBeVisible()
      },
    },
  ] as const

  if (!isMobileProject(testInfo)) {
    for (const section of sections) {
      await expect(page.getByText(section.title, { exact: true }).filter({ visible: true })).toBeVisible()
      await expect(page.getByRole('button', {
        name: section.triggerName,
        includeHidden: true,
      })).toHaveCount(0)
    }

    const logout = page.getByRole('button', { name: 'Logout', exact: true })
    await expect(logout).toBeVisible()
    const accountPanelText = await logout.evaluate((button) => {
      let candidate: HTMLElement | null = button.parentElement
      while (candidate && !candidate.textContent?.includes('Your Account')) candidate = candidate.parentElement
      return candidate?.textContent ?? ''
    })
    for (const value of ['Name', 'admin', 'Email', ADMIN.email, 'Mobile', 'Role']) {
      expect(accountPanelText).toContain(value)
    }

    const clinicType = page.getByRole('button', { name: 'Edit Clinic', exact: true })
    await expect(clinicType).toBeVisible()
    expect(await clinicType.evaluate((button) => button.parentElement?.parentElement?.textContent)).toContain(
      'Clinic',
    )
    expect(await clinicType.evaluate((button) => button.parentElement?.parentElement?.textContent)).toContain(
      'Shared',
    )

    const template = page.getByRole('button', {
      name: 'Edit E2E Standard 6 Sessions',
      exact: true,
    })
    await expect(template).toBeVisible()
    const templateText = await template.evaluate((button) => button.parentElement?.parentElement?.textContent)
    expect(templateText).toContain('6 sessions')
    expect(templateText).toContain('₹750/session')
    expect(templateText).toContain('₹4,500 total')

    await expect(page.getByRole('button', { name: 'Add External Staff', exact: true })).toBeVisible()
    await expect(page.getByLabel('External staff email', { exact: true })).toBeVisible()

    const invitesTitle = page.getByText('Invites', { exact: true }).filter({ visible: true })
    const invitesPanelText = await invitesTitle.evaluate((title) => {
      let candidate: HTMLElement | null = title.parentElement
      while (
        candidate
        && !candidate.textContent?.includes('No invites have been sent yet.')
        && !candidate.textContent?.includes('Last Updated')
      ) candidate = candidate.parentElement
      return candidate?.textContent ?? ''
    })
    expect(invitesPanelText).toMatch(/No invites have been sent yet\.|Last Updated/)
    await guards.assertClean()
    return
  }

  for (const section of sections) {
    const trigger = page.getByRole('button', { name: section.triggerName })
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    const triggerElement = await trigger.elementHandle()
    expect(triggerElement).not.toBeNull()
    await trigger.click()
    await expect.poll(() => triggerElement!.getAttribute('aria-expanded')).toBe('true')

    const dialog = page.getByRole('dialog', { name: section.title, exact: true })
    await expect(dialog).toBeVisible()
    await section.assertContent()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toBeFocused()
  }

  await guards.assertClean()
})

test('admin dashboard uses mobile quick actions and desktop header controls', async ({ page }, testInfo) => {
  const guards = attachErrorGuards(page)

  await page.goto('/')
  await assertMdBreakpoint(page, testInfo)

  const mobileAppointment = page.getByRole('button', {
    name: 'New appt',
    exact: true,
    includeHidden: true,
  })
  const mobileBilling = page.getByRole('link', {
    name: 'New billing',
    exact: true,
    includeHidden: true,
  })
  const desktopAppointment = page.getByRole('button', {
    name: 'New appointment',
    exact: true,
    includeHidden: true,
  })
  const visibleUpNext = page.getByRole('heading', { name: 'Up next', exact: true }).filter({ visible: true })

  await expect(visibleUpNext).toHaveCount(1)

  if (!isMobileProject(testInfo)) {
    await expect(desktopAppointment).toBeVisible()
    await expect(mobileAppointment).toBeHidden()
    await expect(mobileBilling).toBeHidden()
    await guards.assertClean()
    return
  }

  await expect(desktopAppointment).toBeHidden()
  await expect(mobileAppointment).toBeVisible()
  await expect(mobileBilling).toBeVisible()
  const columns = await mobileAppointment.evaluate((element) => (
    getComputedStyle(element.parentElement!).gridTemplateColumns.split(' ').length
  ))
  expect(columns).toBe(2)

  const firstStat = page.getByText('This week', { exact: true })
  expect(await visibleUpNext.evaluate((element, stat) => (
    Boolean(element.compareDocumentPosition(stat as Node) & Node.DOCUMENT_POSITION_FOLLOWING)
  ), await firstStat.elementHandle())).toBe(true)
  const upNextBox = await visibleUpNext.boundingBox()
  const statBox = await firstStat.boundingBox()
  expect(upNextBox).not.toBeNull()
  expect(statBox).not.toBeNull()
  expect(upNextBox!.y).toBeLessThan(statBox!.y)

  await guards.assertClean()
})

test('billing switches balance and payment tables at md and changes package grid columns', async ({ page }, testInfo) => {
  const guards = attachErrorGuards(page)

  await page.goto('/billing?tab=payment_due')
  await assertMdBreakpoint(page, testInfo)

  const desktopBalanceHeaders = ['Patient', 'Sessions', 'Gross Due', 'Balance', 'Due Range']
  for (const header of desktopBalanceHeaders) {
    const locator = page.getByText(header, { exact: true })
    if (isMobileProject(testInfo)) await expect(locator).toBeHidden()
    else await expect(locator).toBeVisible()
  }
  const meeraBalance = page.getByRole('link', { name: /Meera Payment Due/ })
  await expect(meeraBalance).toContainText('₹800')
  const mobileGross = meeraBalance.getByText(/^Gross ₹/)
  if (isMobileProject(testInfo)) await expect(mobileGross).toBeVisible()
  else await expect(mobileGross).toBeHidden()

  await page.getByRole('button', { name: 'Payments', exact: true }).click()
  const desktopPaymentHeaders = ['Date', 'Patient', 'For', 'Method', 'Amount']
  for (const header of desktopPaymentHeaders) {
    const locator = page.getByText(header, { exact: true })
    if (isMobileProject(testInfo)) await expect(locator).toBeHidden()
    else await expect(locator).toBeVisible()
  }
  await expect(page.getByText('Asha Rao', { exact: true }).filter({ visible: true })).toBeVisible()
  const paymentMethod = isMobileProject(testInfo)
    ? page.getByText(/· UPI · 10-Session Physiotherapy Package$/)
    : page.getByText('UPI', { exact: true })
  await expect(paymentMethod).toBeVisible()
  await expect(page.getByRole('button', {
    name: 'Void payment for Asha Rao · ₹8,000',
    exact: true,
  })).toBeVisible()

  await page.getByRole('button', { name: 'Packages', exact: true }).click()
  const packageName = page.getByText('10-Session Physiotherapy Package', { exact: true })
  await expect(packageName).toBeVisible()
  await expect(page.getByText('Asha Rao', { exact: true }).filter({ visible: true })).toBeVisible()
  const cancelPackage = page.getByRole('button', {
    name: 'Cancel package for Asha Rao · 10-Session Physiotherapy Package',
    exact: true,
  })
  await expect(cancelPackage).toBeVisible()
  expect(await cancelPackage.evaluate((button) => (
    button.parentElement?.parentElement?.parentElement?.textContent
  ))).toContain('₹8,000')
  const packageColumnCount = await packageName.evaluate((element) => {
    let candidate = element.parentElement
    while (candidate && getComputedStyle(candidate).display !== 'grid') candidate = candidate.parentElement
    if (!candidate) throw new Error('Package grid was not found')
    return getComputedStyle(candidate).gridTemplateColumns.split(' ').length
  })
  expect(packageColumnCount).toBe(isMobileProject(testInfo) ? 1 : 2)

  await guards.assertClean()
})

test('metric and payment-due pages expose responsive titles, content, and exact Back links', async ({ page }, testInfo) => {
  const guards = attachErrorGuards(page)

  for (const detail of [
    {
      route: '/billing/metrics/received-this-month',
      mobileTitle: 'Received',
      desktopTitle: 'Received',
      content: ['Asha Rao', 'UPI', '₹8,000'],
    },
    {
      route: `/billing/payment-due/${SEED.patientPaymentDue}`,
      mobileTitle: 'Balance detail',
      desktopTitle: 'Meera Payment Due',
      content: ['Meera Payment Due', 'Payments balance detail', 'Unpaid sessions', '₹800'],
    },
  ]) {
    await page.goto(detail.route)
    await assertMdBreakpoint(page, testInfo)
    if (isMobileProject(testInfo)) {
      const back = page.getByRole('link', { name: 'Go back', exact: true })
      await expect(back).toBeVisible()
      await expect(page.getByRole('link', { name: 'Back to billing', exact: true })).toBeHidden()
      expect(await back.evaluate((link) => link.parentElement?.textContent?.trim())).toBe(detail.mobileTitle)
      expect(await back.evaluate((link) => getComputedStyle(link.parentElement!).position)).toBe('sticky')
    } else {
      const back = page.getByRole('link', { name: 'Back to billing', exact: true })
      await expect(back).toBeVisible()
      await expect(page.getByRole('link', { name: 'Go back', exact: true })).toBeHidden()
      await expect(page.getByRole('heading', {
        name: detail.desktopTitle,
        exact: true,
      })).toBeVisible()
      expect(await back.evaluate((link) => link.parentElement?.textContent)).toContain(detail.desktopTitle)
    }
    for (const content of detail.content) {
      await expect(page.getByText(content, { exact: true }).filter({ visible: true }).first()).toBeVisible()
    }
  }

  await guards.assertClean()
})
