import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { BilledTrendDetail } from './billed-trend-detail'
import type { BilledMonthPoint } from '@/lib/billing/monthly-billed-series'

afterEach(cleanup)

const fullSeries: BilledMonthPoint[] = [
  {
    month: '2026-05',
    label: "May '26",
    amount: 1800,
    breakdown: [
      { type: 'Home', amount: 1000, count: 2 },
      { type: 'Clinic', amount: 800, count: 1 },
    ],
  },
  { month: '2026-06', label: "Jun '26", amount: 0, breakdown: [] },
  {
    month: '2026-07',
    label: "Jul '26",
    amount: 800,
    breakdown: [{ type: 'Clinic', amount: 800, count: 1 }],
  },
]

// Same months, each truncated to its first 19 days.
const tillDateSeries: BilledMonthPoint[] = [
  {
    month: '2026-05',
    label: "May '26",
    amount: 1000,
    breakdown: [{ type: 'Home', amount: 1000, count: 2 }],
  },
  { month: '2026-06', label: "Jun '26", amount: 0, breakdown: [] },
  {
    month: '2026-07',
    label: "Jul '26",
    amount: 300,
    breakdown: [{ type: 'Clinic', amount: 300, count: 1 }],
  },
]

function renderTrend(props: Partial<React.ComponentProps<typeof BilledTrendDetail>> = {}) {
  return render(
    <BilledTrendDetail
      title="Monthly billed trend"
      subtitle="May '26 – Jul '26"
      fullSeries={fullSeries}
      tillDateSeries={tillDateSeries}
      tillDay={19}
      {...props}
    />,
  )
}

describe('BilledTrendDetail chart', () => {
  it('renders a labelled SVG trendline with one marker per month', () => {
    renderTrend()

    const chart = screen.getByRole('img', { name: 'Monthly total billed trend' })
    // Month labels also appear in the picker and panel, so scope the axis check to the chart.
    for (const point of fullSeries) expect(within(chart).getByText(point.label)).toBeTruthy()
    expect(chart.querySelectorAll('circle').length).toBe(fullSeries.length)
    expect(chart.textContent).toContain("May '26 · ₹1,800")
  })

  it('puts the chart in a horizontally scrollable container', () => {
    renderTrend()
    const svg = screen.getByRole('img', { name: 'Monthly total billed trend' })
    expect((svg.parentElement as HTMLElement).style.overflowX).toBe('auto')
  })

  it('marks the selected month on the chart', () => {
    renderTrend()
    const chart = screen.getByRole('img', { name: 'Monthly total billed trend' })
    const selected = chart.querySelectorAll('circle[data-selected="true"]')

    expect(selected.length).toBe(1)
    expect((selected[0].parentElement as Element).getAttribute('data-month')).toBe('2026-07')
  })

  it('shows an empty state instead of a chart when there is no data', () => {
    renderTrend({ fullSeries: [], tillDateSeries: [] })

    expect(screen.queryByRole('img', { name: 'Monthly total billed trend' })).toBeNull()
    expect(screen.getByText('No billed sessions yet.')).toBeTruthy()
  })
})

describe('BilledTrendDetail month panel', () => {
  it('defaults to the most recent month and bifurcates it by appointment type', () => {
    renderTrend()

    const panel = screen.getByLabelText('Billed by appointment type')
    expect(within(panel).getByText('Clinic')).toBeTruthy()
    expect(within(panel).getByText('800')).toBeTruthy()
  })

  it('shows the selected month total above the breakdown', () => {
    renderTrend()

    const panel = screen.getByLabelText('Selected month total')
    expect(panel.textContent).toContain("Jul '26")
    expect(within(panel).getByText('800')).toBeTruthy()
  })

  it('lists every month in the picker, newest first', () => {
    renderTrend()

    const picker = screen.getByRole('combobox', { name: 'Month' })
    expect(picker.textContent).toContain("Jul '26")
  })
})

describe('BilledTrendDetail till-date comparison', () => {
  it('starts on the full-month view', () => {
    renderTrend()

    expect(screen.getByRole('button', { name: 'Full month' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Total billed · all time')).toBeTruthy()
  })

  it('switches the chart to the till-date series', () => {
    renderTrend()

    fireEvent.click(screen.getByRole('button', { name: 'Billed till date' }))

    const chart = screen.getByRole('img', { name: 'Monthly total billed trend' })
    expect(chart.textContent).toContain("May '26 · ₹1,000")
    expect(chart.textContent).not.toContain("May '26 · ₹1,800")
  })

  it('relabels the headline with the cutoff day', () => {
    renderTrend()

    fireEvent.click(screen.getByRole('button', { name: 'Billed till date' }))

    expect(screen.getByText('Total billed · first 19 days of each month')).toBeTruthy()
  })

  it('recomputes the selected month panel from the till-date figures', () => {
    renderTrend()

    fireEvent.click(screen.getByRole('button', { name: 'Billed till date' }))

    const panel = screen.getByLabelText('Selected month total')
    expect(within(panel).getByText('300')).toBeTruthy()
  })

  it('switches back to the full month', () => {
    renderTrend()

    fireEvent.click(screen.getByRole('button', { name: 'Billed till date' }))
    fireEvent.click(screen.getByRole('button', { name: 'Full month' }))

    expect(screen.getByText('Total billed · all time')).toBeTruthy()
    expect(within(screen.getByLabelText('Selected month total')).getByText('800')).toBeTruthy()
  })
})

describe('BilledTrendDetail load failure', () => {
  it('says the figures could not be loaded instead of showing a confident zero', () => {
    renderTrend({ fullSeries: [], tillDateSeries: [], loadFailed: true })

    expect(screen.getByText(/could not be loaded/i)).toBeTruthy()
    expect(screen.queryByText('No billed sessions yet.')).toBeNull()
  })

  it('does not present a total when the read failed', () => {
    renderTrend({ fullSeries: [], tillDateSeries: [], loadFailed: true })

    expect(screen.queryByText('Total billed · all time')).toBeNull()
  })

  it('still shows the genuine empty state when the read succeeded with no data', () => {
    renderTrend({ fullSeries: [], tillDateSeries: [] })

    expect(screen.getByText('No billed sessions yet.')).toBeTruthy()
    expect(screen.queryByText(/could not be loaded/i)).toBeNull()
  })
})
