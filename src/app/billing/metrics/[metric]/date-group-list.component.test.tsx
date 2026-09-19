import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { DateGroupList } from './date-group-list'
import { groupMetricRowsByDate } from '@/lib/billing/date-grouped-records'
import type { MetricRow } from './metric-detail'

afterEach(cleanup)

const rows: MetricRow[] = [
  { id: 'a1', date: '2026-09-18', title: 'Radhika mom', meta: 'clinic', amount: 600 },
  { id: 'a2', date: '2026-09-18', title: 'Mahika', meta: 'clinic', amount: 650 },
  { id: 'a3', date: '2026-09-17', title: 'Kavitha', meta: 'online', amount: 750 },
]

const groups = groupMetricRowsByDate(rows)

function renderList(props: Partial<React.ComponentProps<typeof DateGroupList>> = {}) {
  return render(
    <DateGroupList groups={groups} emptyLabel="No completed sessions in this period." unitLabel="session" {...props} />,
  )
}

describe('DateGroupList', () => {
  it('shows one collapsed row per date with that date total', () => {
    renderList()

    const header = screen.getByRole('button', { name: /18 Sep/ })
    expect(within(header).getByText('2 sessions')).toBeTruthy()
    expect(within(header).getByText('1,250')).toBeTruthy()
    expect(screen.getByRole('button', { name: /17 Sep/ })).toBeTruthy()
  })

  it('hides the individual records until a date is expanded', () => {
    renderList()

    expect(screen.queryByText('Radhika mom')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /18 Sep/ }))

    expect(screen.getByText('Radhika mom')).toBeTruthy()
    expect(screen.getByText('Mahika')).toBeTruthy()
  })

  it('reveals only the expanded date, leaving other dates collapsed', () => {
    renderList()

    fireEvent.click(screen.getByRole('button', { name: /18 Sep/ }))

    expect(screen.queryByText('Kavitha')).toBeNull()
  })

  it('collapses a date again when its header is clicked twice', () => {
    renderList()
    const header = screen.getByRole('button', { name: /18 Sep/ })

    fireEvent.click(header)
    fireEvent.click(header)

    expect(screen.queryByText('Radhika mom')).toBeNull()
  })

  it('keeps several dates open at once', () => {
    renderList()

    fireEvent.click(screen.getByRole('button', { name: /18 Sep/ }))
    fireEvent.click(screen.getByRole('button', { name: /17 Sep/ }))

    expect(screen.getByText('Radhika mom')).toBeTruthy()
    expect(screen.getByText('Kavitha')).toBeTruthy()
  })

  it('reports expansion state to assistive tech', () => {
    renderList()
    const header = screen.getByRole('button', { name: /18 Sep/ })

    expect(header.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
  })

  it('shows a negative date total when refunds outweigh payments', () => {
    const refundGroups = groupMetricRowsByDate([
      { id: 'p1', date: '2026-09-18', title: 'Asha', meta: 'upi', amount: 500 },
      { id: 'r1', date: '2026-09-18', title: 'Asha', meta: 'UPI refund', amount: -800 },
    ])

    renderList({ groups: refundGroups, unitLabel: 'record' })

    const header = screen.getByRole('button', { name: /18 Sep/ })
    expect(within(header).getByText('2 records')).toBeTruthy()
    expect(within(header).getByText('-300')).toBeTruthy()
  })

  it('singularises the unit label for a one-record date', () => {
    const single = groupMetricRowsByDate([rows[2]])

    renderList({ groups: single })

    expect(within(screen.getByRole('button', { name: /17 Sep/ })).getByText('1 session')).toBeTruthy()
  })

  it('shows the empty state instead of any headers when there are no groups', () => {
    renderList({ groups: [] })

    expect(screen.getByText('No completed sessions in this period.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
