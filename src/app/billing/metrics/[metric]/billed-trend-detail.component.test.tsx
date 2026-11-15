import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

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

const chartName = 'Monthly total billed trend'
const getChart = () => screen.getByRole('group', { name: chartName })
const readout = () => document.querySelector('[data-chart-readout]') as HTMLElement | null
const hitFor = (month: string) => document.querySelector(`[data-hit-month="${month}"]`) as SVGRectElement

describe('BilledTrendDetail chart', () => {
  it('draws a column and a total-line marker for every month, with month labels', () => {
    renderTrend()

    const chart = getChart()
    // Month labels also appear in the picker and panel, so scope the axis check to the chart.
    for (const point of fullSeries) expect(within(chart).getByText(point.label)).toBeTruthy()
    expect(chart.querySelectorAll('[data-month] circle').length).toBe(fullSeries.length)
    expect(chart.querySelectorAll('[data-bar-month]').length).toBe(fullSeries.length)
  })

  it('stacks each month by appointment type, largest all-time type on the baseline', () => {
    renderTrend()

    const may = getChart().querySelector('[data-bar-month="2026-05"]') as Element
    // Home (1,000 all-time) and Clinic (1,600 all-time): Clinic is the bigger type, so it sits first.
    const parts = [...may.querySelectorAll('[data-segment]')].map((el) => el.getAttribute('data-segment'))
    expect(parts).toEqual(['Clinic', 'Home'])
    // A gap month draws no column parts.
    expect(getChart().querySelector('[data-bar-month="2026-06"] [data-segment]')).toBeNull()
  })

  it('names every appointment type and the total line in a legend', () => {
    renderTrend()

    const legend = screen.getByRole('list', { name: 'Chart legend' })
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Clinic', 'Home', 'Total'])
  })

  it('keeps a type in the same colour when the range switches', () => {
    renderTrend()
    const fullColor = getChart().querySelector('[data-bar-month="2026-05"] [data-segment="Home"]')?.getAttribute('fill')

    chooseOption('Trend range', 'Billed till date')

    // Till date, May only has Home — it must not be repainted in the first slot's colour.
    const tillColor = getChart().querySelector('[data-bar-month="2026-05"] [data-segment="Home"]')?.getAttribute('fill')
    expect(tillColor).toBe(fullColor)
  })

  it('gives each month an accessible button that reads out its total and split', () => {
    renderTrend()

    expect(screen.getByRole('button', { name: "May '26: total ₹1,800. Home ₹1,000, Clinic ₹800" })).toBeTruthy()
    expect(screen.getByRole('button', { name: "Jun '26: total ₹0, nothing billed" })).toBeTruthy()
  })

  it('puts the chart in a horizontally scrollable container', () => {
    renderTrend()
    expect((document.querySelector('[data-chart-scroll]') as HTMLElement).style.overflowX).toBe('auto')
  })

  it('marks the selected month on the chart and labels its total', () => {
    renderTrend()
    const chart = getChart()
    const selected = chart.querySelectorAll('circle[data-selected="true"]')

    expect(selected.length).toBe(1)
    expect((selected[0].parentElement as Element).getAttribute('data-month')).toBe('2026-07')
    expect(chart.querySelector('[data-total-label]')?.textContent).toBe('₹800')
  })

  it('shows an empty state instead of a chart when there is no data', () => {
    renderTrend({ fullSeries: [], tillDateSeries: [] })

    expect(screen.queryByRole('group', { name: chartName })).toBeNull()
    expect(screen.getByText('No billed sessions yet.')).toBeTruthy()
  })
})

describe('BilledTrendDetail chart readout (tap / hover)', () => {
  it('shows no readout until a month is touched', () => {
    renderTrend()
    expect(readout()).toBeNull()
  })

  it('a tap pins the month total and per-type amounts, and moves the month panel to it', () => {
    renderTrend()

    fireEvent.click(hitFor('2026-05'))

    const box = readout() as HTMLElement
    expect(box.textContent).toContain("May '26")
    expect(box.textContent).toContain('₹1,800Total')
    // Top of the stack first, matching what the eye sees.
    expect(box.textContent).toContain('₹1,000Home₹800Clinic')
    expect(screen.getByLabelText('Selected month total').textContent).toContain("May '26")
    expect(screen.getByRole('combobox', { name: 'Month' }).textContent).toContain("May '26")
  })

  it('a second tap on the same month closes the readout but keeps the selection', () => {
    renderTrend()

    fireEvent.click(hitFor('2026-05'))
    fireEvent.click(hitFor('2026-05'))

    expect(readout()).toBeNull()
    expect(screen.getByLabelText('Selected month total').textContent).toContain("May '26")
  })

  it('a tap outside the chart dismisses the readout', () => {
    renderTrend()

    fireEvent.click(hitFor('2026-05'))
    fireEvent.pointerDown(document.body)

    expect(readout()).toBeNull()
  })

  it('says when a tapped month billed nothing', () => {
    renderTrend()

    fireEvent.click(hitFor('2026-06'))

    expect(readout()?.textContent).toContain('Nothing billed')
  })

  it('follows the mouse on hover and clears when it leaves', () => {
    renderTrend()

    fireEvent.pointerMove(hitFor('2026-05'), { pointerType: 'mouse' })
    expect(readout()?.textContent).toContain("May '26")

    fireEvent.pointerLeave(getChart(), { pointerType: 'mouse' })
    expect(readout()).toBeNull()
  })

  it('ignores touch movement, so scrolling the chart never pops a readout', () => {
    renderTrend()

    fireEvent.pointerMove(hitFor('2026-05'), { pointerType: 'touch' })

    expect(readout()).toBeNull()
  })

  it('shows the readout on keyboard focus and moves with the arrow keys', () => {
    renderTrend()

    act(() => hitFor('2026-05').focus())
    expect(readout()?.textContent).toContain("May '26")

    fireEvent.keyDown(hitFor('2026-05'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(hitFor('2026-06'))
    expect(readout()?.textContent).toContain("Jun '26")

    fireEvent.keyDown(hitFor('2026-06'), { key: 'Enter' })
    expect(screen.getByLabelText('Selected month total').textContent).toContain("Jun '26")
  })

  it('updates the readout figures when the range switches', () => {
    renderTrend()

    fireEvent.click(hitFor('2026-05'))
    chooseOption('Trend range', 'Billed till date')

    expect(readout()?.textContent).toContain('₹1,000Total')
  })
})

describe('BilledTrendDetail month panel', () => {
  it('defaults to the most recent month and bifurcates it by appointment type', () => {
    renderTrend()

    const panel = screen.getByLabelText('Billed by appointment type')
    expect(within(panel).getByText('Clinic')).toBeTruthy()
    expect(within(panel).getByText('800')).toBeTruthy()
  })

  it('ties each panel row to the chart with the same colour swatch', () => {
    renderTrend()

    const swatch = screen.getByLabelText('Billed by appointment type').querySelector('[data-type-swatch]') as HTMLElement
    const bar = getChart().querySelector('[data-bar-month="2026-07"] [data-segment="Clinic"]') as Element
    expect(swatch.style.background).not.toBe('')
    expect(normalizeColor(swatch.style.background)).toBe(normalizeColor(bar.getAttribute('fill') ?? ''))
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

/** jsdom reports inline colours as rgb(); SVG fill attributes keep the hex. Compare as rgb. */
function normalizeColor(value: string): string {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i)
  if (!hex) return value.replace(/\s+/g, '')
  const n = parseInt(hex[1], 16)
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`
}

/** Open a Radix select by keyboard and choose an option — no pointer events needed in jsdom. */
function chooseOption(comboboxName: string, optionName: string) {
  const trigger = screen.getByRole('combobox', { name: comboboxName })
  fireEvent.keyDown(trigger, { key: 'Enter' })
  fireEvent.click(screen.getByRole('option', { name: optionName }))
}

describe('BilledTrendDetail till-date comparison', () => {
  it('starts on the full-month view', () => {
    renderTrend()

    expect(screen.getByRole('combobox', { name: 'Trend range' }).textContent).toContain('Full month')
    expect(screen.getByText('Total billed · all time')).toBeTruthy()
  })

  it('offers the range as a dropdown, not a pair of buttons', () => {
    renderTrend()

    expect(screen.getByRole('combobox', { name: 'Trend range' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Full month' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Billed till date' })).toBeNull()
  })

  it('switches the chart to the till-date series', () => {
    renderTrend()

    chooseOption('Trend range', 'Billed till date')

    expect(screen.getByRole('button', { name: /^May '26: total ₹1,000\./ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^May '26: total ₹1,800/ })).toBeNull()
  })

  it('relabels the headline with the cutoff day', () => {
    renderTrend()

    chooseOption('Trend range', 'Billed till date')

    expect(screen.getByText('Total billed · first 19 days of each month')).toBeTruthy()
  })

  it('recomputes the selected month panel from the till-date figures', () => {
    renderTrend()

    chooseOption('Trend range', 'Billed till date')

    const panel = screen.getByLabelText('Selected month total')
    expect(within(panel).getByText('300')).toBeTruthy()
  })

  it('switches back to the full month', () => {
    renderTrend()

    chooseOption('Trend range', 'Billed till date')
    chooseOption('Trend range', 'Full month')

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

describe('BilledTrendDetail month-on-month change', () => {
  const threeMonths: BilledMonthPoint[] = [
    {
      month: '2026-08', label: "Aug '26", amount: 1500,
      breakdown: [{ type: 'Clinic', amount: 1000, count: 2 }, { type: 'Home', amount: 500, count: 1 }],
    },
    {
      month: '2026-09', label: "Sep '26", amount: 1900,
      breakdown: [{ type: 'Clinic', amount: 1500, count: 3 }, { type: 'Home', amount: 400, count: 1 }],
    },
    { month: '2026-10', label: "Oct '26", amount: 200, breakdown: [{ type: 'Clinic', amount: 200, count: 1 }] },
  ]
  const tile = () => screen.getByLabelText('Selected month total')
  const table = () => screen.getByLabelText('Billed by appointment type')
  const row = (type: string) => table().querySelector(`[data-type-row="${type}"]`) as HTMLElement

  it('shows the selected month against the month before, as a percentage and in rupees', () => {
    renderTrend({ fullSeries: threeMonths, tillDateSeries: threeMonths })
    chooseOption('Month', "Sep '26")

    const change = tile().querySelector('[data-month-change]') as HTMLElement
    expect(change.textContent).toBe("+27%+₹400 vs Aug '26")
    expect(within(change).getByLabelText("up 27% on Aug '26")).toBeTruthy()
  })

  it('gives every appointment type its own change, coloured and arrowed by direction', () => {
    renderTrend({ fullSeries: threeMonths, tillDateSeries: threeMonths })
    chooseOption('Month', "Sep '26")

    expect(table().textContent).toContain("vs Aug '26")
    expect(row('Clinic').querySelector('[data-delta="up"]')?.textContent).toBe('+50%')
    expect(row('Home').querySelector('[data-delta="down"]')?.textContent).toBe('−20%')
  })

  it('does not print a slump for the month still being billed, and offers the like-for-like view', () => {
    renderTrend({ fullSeries: threeMonths, tillDateSeries: threeMonths })

    expect(tile().textContent).toContain('month in progress')
    expect(tile().querySelector('[data-delta]')).toBeNull()
    expect(table().querySelector('[data-delta]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Compare billed till date' }))

    expect(screen.getByRole('combobox', { name: 'Trend range' }).textContent).toContain('Billed till date')
    // Till date, the current month is compared like for like: 200 against 1,900.
    expect(tile().querySelector('[data-delta="down"]')?.textContent).toBe('−89%')
  })

  it('keeps a type that billed last month but not this one, as a −100% row', () => {
    renderTrend()
    chooseOption('Month', "Jun '26")

    expect(row('Home').textContent).toContain('0 sessions')
    expect(row('Home').querySelector('[data-delta="down"]')?.textContent).toBe('−100%')
    expect(tile().querySelector('[data-month-change]')?.textContent).toBe("−100%−₹1,800 vs May '26")
  })

  it('calls growth from nothing "New" instead of an infinite percentage', () => {
    renderTrend()
    chooseOption('Trend range', 'Billed till date')

    // Jul till date (300) against Jun (0).
    expect(tile().querySelector('[data-delta="new"]')?.textContent).toBe('New')
    expect(row('Clinic').querySelector('[data-delta="new"]')).toBeTruthy()
  })

  it('says the first month on record has nothing to compare with', () => {
    renderTrend()
    chooseOption('Month', "May '26")

    expect(tile().textContent).toContain('First month on record')
    expect(table().querySelector('[data-delta]')).toBeNull()
  })
})

describe('BilledTrendDetail on the 1st of the month', () => {
  it('turns the till-date view off, since no day of the month has finished', () => {
    renderTrend({ tillDay: 0, tillDateSeries: [] })

    const trigger = screen.getByRole('combobox', { name: 'Trend range' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const option = screen.getByRole('option', { name: 'Billed till date (from the 2nd)' })
    expect(option.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByLabelText('Selected month total').textContent).toContain('From the 2nd, Billed till date compares it')
  })
})

describe('BilledTrendDetail till-date wording', () => {
  it('names the cutoff as the last finished day', () => {
    renderTrend()
    chooseOption('Trend range', 'Billed till date')

    expect(screen.getByText('Every month counted to day 19 only, the last finished day, so months compare like for like.')).toBeTruthy()
  })

  it('says "day" for a one-day cutoff', () => {
    renderTrend({ tillDay: 1 })
    chooseOption('Trend range', 'Billed till date')

    expect(screen.getByText('Total billed · first 1 day of each month')).toBeTruthy()
  })
})
