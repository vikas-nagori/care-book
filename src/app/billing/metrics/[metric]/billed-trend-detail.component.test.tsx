import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { BilledTrendDetail } from './billed-trend-detail'
import type { BilledMonthPoint } from '@/lib/billing/monthly-billed-series'

afterEach(cleanup)

const series: BilledMonthPoint[] = [
  { month: '2026-05', label: "May '26", amount: 1800 },
  { month: '2026-06', label: "Jun '26", amount: 0 },
  { month: '2026-07', label: "Jul '26", amount: 800 },
]

describe('BilledTrendDetail', () => {
  it('renders a labelled SVG trendline with one marker per month', () => {
    render(<BilledTrendDetail title="Monthly billed trend" subtitle="May '26 – Jul '26" total={2600} series={series} />)

    const chart = screen.getByRole('img', { name: 'Monthly total billed trend' })
    expect(chart).toBeTruthy()
    // Each month contributes an x-axis label…
    for (const point of series) expect(screen.getByText(point.label)).toBeTruthy()
    // …and a native <title> hover tooltip carrying its value.
    expect(chart.querySelectorAll('circle').length).toBe(series.length)
    expect(chart.textContent).toContain("May '26 · ₹1,800")
  })

  it('puts the chart in a horizontally scrollable container', () => {
    render(<BilledTrendDetail title="Monthly billed trend" subtitle="x" total={2600} series={series} />)
    const svg = screen.getByRole('img', { name: 'Monthly total billed trend' })
    const scroller = svg.parentElement as HTMLElement
    expect(scroller.style.overflowX).toBe('auto')
  })

  it('shows an empty state instead of a chart when there is no data', () => {
    render(<BilledTrendDetail title="Monthly billed trend" subtitle="No billed sessions yet" total={0} series={[]} />)
    expect(screen.queryByRole('img', { name: 'Monthly total billed trend' })).toBeNull()
    expect(screen.getByText('No billed sessions yet.')).toBeTruthy()
  })
})
