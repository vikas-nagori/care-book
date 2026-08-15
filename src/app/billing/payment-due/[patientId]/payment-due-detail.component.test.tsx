import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

import { PaymentDueDetail, type PaymentDuePackage, type PaymentDueSession } from './payment-due-detail'

afterEach(cleanup)

const completed: PaymentDueSession[] = [
  { id: 'c1', date: '2026-08-10', time: '09:00:00', type: 'Clinic', fee: 800 },
]

const scheduled: PaymentDueSession[] = [
  { id: 's1', date: '2026-08-20', time: '11:00:00', type: 'Clinic', fee: 500 },
]

const packages: PaymentDuePackage[] = [
  {
    id: 'pkg-1',
    name: '7',
    status: 'active',
    availedSessions: 3,
    scheduledSessions: 1,
    totalSessions: 5,
    quoteAmount: 3250,
    netReceived: 3250,
    dueAmount: 0,
    refundableCredit: 1300,
  },
]

function renderDetail(overrides: Partial<React.ComponentProps<typeof PaymentDueDetail>> = {}) {
  return render(
    <PaymentDueDetail
      patientName="Nayana Pai"
      sessions={completed}
      scheduledSessions={scheduled}
      packages={packages}
      ordinaryDue={1300}
      ordinaryCredit={0}
      packageDue={0}
      packageCredit={0}
      {...overrides}
    />,
  )
}

function cardFor(section: 'unpaid' | 'scheduled') {
  return screen.getByTestId(`${section}-sessions-card`)
}

describe('PaymentDueDetail', () => {
  it('lists scheduled sessions alongside completed ones so the tiles reconcile', () => {
    renderDetail()

    expect(within(cardFor('unpaid')).getByText('10 Aug 2026')).toBeTruthy()
    expect(within(cardFor('scheduled')).getByText('20 Aug 2026')).toBeTruthy()
  })

  it('subtotals each section separately', () => {
    renderDetail()

    const unpaid = cardFor('unpaid')
    expect(within(unpaid).getByText('Session fees shown')).toBeTruthy()
    expect(unpaid.textContent).toContain('800')

    const upcoming = cardFor('scheduled')
    expect(within(upcoming).getByText('Scheduled fees shown')).toBeTruthy()
    expect(upcoming.textContent).toContain('500')
  })

  it('does not call the balance settled when only scheduled sessions remain', () => {
    renderDetail({ sessions: [], ordinaryDue: 500 })

    const unpaid = cardFor('unpaid')
    expect(unpaid.textContent).toContain('comes from the scheduled sessions below')
    expect(unpaid.textContent).not.toContain('settled')
  })

  it('still reports a settled balance when neither list has anything in it', () => {
    renderDetail({ sessions: [], scheduledSessions: [], ordinaryDue: 0 })

    expect(cardFor('unpaid').textContent).toContain('settled')
    expect(cardFor('scheduled').textContent).toContain('No scheduled sessions')
  })

  it('names refundable credit when the balance is a credit and nothing is outstanding', () => {
    renderDetail({ sessions: [], scheduledSessions: [], ordinaryDue: 0, ordinaryCredit: 1300 })

    expect(cardFor('unpaid').textContent).toContain('refundable credit')
  })

  it('shows a package progress card that explains the package tiles', () => {
    renderDetail({ packageCredit: 1300 })

    const card = screen.getByTestId('package-progress-pkg-1')
    expect(card.textContent).toContain('3 availed · 1 scheduled · 5 total')
    expect(card.textContent).toContain('60%')
    expect(card.textContent).toContain('1,300')
    expect(within(card).getByLabelText('7 session progress')).toBeTruthy()
  })

  it('links each package card onward to its session history', () => {
    renderDetail()

    expect(screen.getByTestId('package-progress-pkg-1').getAttribute('href')).toBe('/billing/packages/pkg-1')
  })

  it('hides the packages section entirely when the patient has none', () => {
    renderDetail({ packages: [] })

    expect(screen.queryByTestId('package-progress-list')).toBeNull()
    expect(screen.queryByText('Packages')).toBeNull()
  })
})
