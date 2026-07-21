import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

import { MetricDetail, type MetricRow } from './metric-detail'
import type { AppointmentTypeBreakdownRow } from '@/lib/billing/appointment-type-breakdown'

afterEach(cleanup)

const rows: MetricRow[] = [
  { id: 'a1', date: '2026-07-02', title: 'Asha Rao', meta: 'clinic', amount: 800 },
  { id: 'a2', date: '2026-07-03', title: 'Ravi Kumar', meta: 'home_visit', amount: 1000 },
]

describe('MetricDetail appointment-type breakdown strip', () => {
  it('renders a per-type strip above the list when there are 2+ types', () => {
    const breakdown: AppointmentTypeBreakdownRow[] = [
      { type: 'clinic', amount: 1600, count: 2 },
      { type: 'home_visit', amount: 1000, count: 1 },
    ]

    render(
      <MetricDetail
        title="Total billed"
        subtitle="July 2026"
        total={2600}
        rows={rows}
        breakdown={breakdown}
        emptyLabel="No completed sessions in this period."
      />,
    )

    const strip = screen.getByLabelText('Billed by appointment type')
    expect(within(strip).getByText('clinic')).toBeTruthy()
    expect(within(strip).getByText('home_visit')).toBeTruthy()
    expect(within(strip).getByText('2 sessions')).toBeTruthy()
    expect(within(strip).getByText('1 session')).toBeTruthy()
    expect(within(strip).getByText('1,600')).toBeTruthy()
  })

  it('hides the strip when there is only one appointment type (no bifurcation to show)', () => {
    const breakdown: AppointmentTypeBreakdownRow[] = [{ type: 'clinic', amount: 1600, count: 2 }]

    render(
      <MetricDetail
        title="Total billed"
        subtitle="July 2026"
        total={1600}
        rows={rows}
        breakdown={breakdown}
        emptyLabel="No completed sessions in this period."
      />,
    )

    expect(screen.queryByLabelText('Billed by appointment type')).toBeNull()
  })

  it('hides the strip entirely when no breakdown is provided (e.g. the Received drill-down)', () => {
    render(
      <MetricDetail
        title="Received"
        subtitle="July 2026"
        total={2600}
        rows={rows}
        emptyLabel="No payments received in this period."
      />,
    )

    expect(screen.queryByLabelText('Billed by appointment type')).toBeNull()
  })
})

describe('MetricDetail pagination', () => {
  it('renders page navigation with whole-period record count and metric-scoped links', () => {
    render(
      <MetricDetail
        title="Received"
        subtitle="July 2026"
        total={99000}
        rows={rows}
        totalCount={57}
        pagination={{ page: 2, totalPages: 3, basePath: '/billing/metrics/received-this-month' }}
        emptyLabel="No payments received in this period."
      />,
    )

    // Meta reflects the whole period, not just the page's rows.
    expect(screen.getByText('57 records')).toBeTruthy()

    const nav = screen.getByRole('navigation', { name: 'Received pages' })
    const prev = within(nav).getByRole('link', { name: 'Previous' })
    const next = within(nav).getByRole('link', { name: 'Next' })
    expect(prev.getAttribute('href')).toBe('/billing/metrics/received-this-month?page=1')
    expect(next.getAttribute('href')).toBe('/billing/metrics/received-this-month?page=3')
    // Current page is marked.
    expect(within(nav).getByRole('link', { name: '2' }).getAttribute('aria-current')).toBe('page')
  })

  it('omits pagination when there is a single page', () => {
    render(
      <MetricDetail
        title="Received"
        subtitle="July 2026"
        total={800}
        rows={rows}
        totalCount={2}
        pagination={{ page: 1, totalPages: 1, basePath: '/billing/metrics/received-this-month' }}
        emptyLabel="No payments received in this period."
      />,
    )

    expect(screen.queryByRole('navigation', { name: 'Received pages' })).toBeNull()
  })
})
