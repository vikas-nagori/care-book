'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MobilePageHeader } from '@/components/layout/mobile-page-header'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { BilledMonthPoint } from '@/lib/billing/monthly-billed-series'
import { buildTypeLegend } from '@/lib/billing/billed-trend-chart-model'
import { compareWithPreviousMonth } from '@/lib/billing/billed-month-comparison'
import { BilledTrendChart } from './billed-trend-chart'
import { DeltaBadge, TypeComparisonTable, signedRupees } from './month-comparison'
import { Money } from './money'
import { LoadFailureNotice } from './load-failure-notice'

type TrendMode = 'full' | 'tillDate'

type BilledTrendDetailProps = {
  title: string
  subtitle: string
  /** One point per month, each month counted in full. */
  fullSeries: BilledMonthPoint[]
  /** The same months, each counted only up to `tillDay` — the like-for-like pace comparison. */
  tillDateSeries: BilledMonthPoint[]
  /**
   * Last finished day of the current month (yesterday's day of month) — the "billed till date" view
   * counts every month to this day. 0 on the 1st, when no day has finished and the view is off.
   */
  tillDay: number
  /** The aggregation query failed — say so rather than render an all-time total of zero. */
  loadFailed?: boolean
}

// The Billed drill-down as a month-by-month trendline, with a mode toggle and a month picker below
// it. Both series are handed over up front, so switching mode or month is instant — no refetch. The
// picked month gets a total plus its appointment-type bifurcation; individual sessions are not
// listed here, that is what the Total billed drill-down is for.
export function BilledTrendDetail({
  title,
  subtitle,
  fullSeries,
  tillDateSeries,
  tillDay,
  loadFailed = false,
}: BilledTrendDetailProps) {
  const [mode, setMode] = useState<TrendMode>('full')
  const series = mode === 'full' ? fullSeries : tillDateSeries

  const [selectedMonth, setSelectedMonth] = useState<string>(
    () => fullSeries[fullSeries.length - 1]?.month ?? '',
  )

  const selected = useMemo(
    () => series.find((point) => point.month === selectedMonth) ?? series[series.length - 1],
    [series, selectedMonth],
  )

  // Colours are fixed from the full history so a type keeps its colour across the range toggle.
  const legend = useMemo(() => buildTypeLegend(fullSeries), [fullSeries])

  const total = useMemo(() => series.reduce((sum, point) => sum + point.amount, 0), [series])
  const days = `${tillDay} day${tillDay === 1 ? '' : 's'}`
  const headline = mode === 'full' ? 'Total billed · all time' : `Total billed · first ${days} of each month`
  const tillDateAvailable = tillDay >= 1

  // The current month is always the last point; in full-month mode it is still being billed, so a
  // change against last month's complete total would read as a slump. That case points at the
  // till-date view instead of printing a misleading percentage.
  const currentMonth = fullSeries[fullSeries.length - 1]?.month
  const inProgress = mode === 'full' && selected?.month === currentMonth
  const comparison = useMemo(
    () => (selected && !inProgress ? compareWithPreviousMonth(series, selected.month) : null),
    [series, selected, inProgress],
  )
  const tableRows = comparison ? comparison.byType : selected?.breakdown ?? []
  // Newest month first — the months people look at most are the ones just gone.
  const pickerMonths = useMemo(() => [...series].reverse(), [series])

  return (
    <div className="px-4 pb-4 md:p-6">
      <MobilePageHeader title={title} backHref="/billing" />

      <div className="hidden md:flex items-center gap-2" style={{ marginBottom: 20 }}>
        <Button variant="ghost" size="icon" asChild>
          <Link href="/billing" aria-label="Back to billing"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ph-ink)' }}>
            {title}
          </h1>
          <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 2 }}>{subtitle}</div>
        </div>
      </div>

      <div className="md:hidden" style={{ margin: '12px 0 16px' }}>
        <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)' }}>{subtitle}</div>
      </div>

      {loadFailed ? (
        <LoadFailureNotice subject="The billing trend" />
      ) : (
        <>
      {/* The range sits with the headline it governs, so the figure below always states its own basis. */}
      <div className="mb-2.5 w-full md:max-w-[260px]">
        <Select value={mode} onValueChange={(next) => setMode(next as TrendMode)}>
          <SelectTrigger aria-label="Trend range" style={{ minHeight: 44 }}>
            <SelectValue>{mode === 'full' ? 'Full month' : 'Billed till date'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="full">Full month</SelectItem>
            <SelectItem value="tillDate" disabled={!tillDateAvailable}>
              {tillDateAvailable ? 'Billed till date' : 'Billed till date (from the 2nd)'}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="ph-stat mb-2">
        <div className="ph-stat-label"><span>{headline}</span></div>
        <div className="ph-stat-value"><Money n={total} /></div>
        <div className="ph-stat-meta">{series.length} month{series.length === 1 ? '' : 's'}</div>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', margin: '0 0 16px' }}>
        {mode === 'full'
          ? 'Every month counted in full.'
          : `Every month counted to day ${tillDay} only, the last finished day, so months compare like for like.`}
      </div>

      {series.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13, background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10 }}>
          No billed sessions yet.
        </div>
      ) : (
        <>
          <BilledTrendChart
            series={series}
            legend={legend}
            selectedMonth={selected?.month}
            onSelectMonth={setSelectedMonth}
          />

          <div style={{ marginTop: 16, marginBottom: 12 }}>
            <Select value={selected?.month ?? ''} onValueChange={setSelectedMonth}>
              <SelectTrigger aria-label="Month" style={{ minHeight: 44 }}>
                <SelectValue>{selected?.label ?? 'Select a month'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {pickerMonths.map((point) => (
                  <SelectItem key={point.month} value={point.month}>
                    {point.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selected && (
            <>
              <div
                className="ph-stat mb-3"
                aria-label="Selected month total"
              >
                <div className="ph-stat-label"><span>Billed · {selected.label}</span></div>
                <div className="ph-stat-value"><Money n={selected.amount} /></div>
                <div className="ph-stat-meta">
                  {mode === 'full' ? (inProgress ? 'month in progress' : 'whole month') : `first ${days}`}
                </div>
                <div data-month-change style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', marginTop: 8, fontSize: 12, color: 'var(--ph-ink-3)' }}>
                  {comparison ? (
                    <>
                      <DeltaBadge delta={comparison.total} against={comparison.previous.label} />
                      <span>
                        {comparison.total.kind === 'none'
                          ? `Nothing billed in either ${selected.label} or ${comparison.previous.label}`
                          : `${signedRupees(comparison.total.difference)} vs ${comparison.previous.label}`}
                      </span>
                    </>
                  ) : inProgress ? (
                    <span>
                      Still being billed.{' '}
                      {tillDateAvailable ? (
                        <button
                          type="button"
                          onClick={() => setMode('tillDate')}
                          style={{ color: 'var(--ph-accent)', fontWeight: 600, textDecoration: 'underline', minHeight: 44, padding: 0, background: 'none', border: 0 }}
                        >
                          Compare billed till date
                        </button>
                      ) : (
                        'From the 2nd, Billed till date compares it with last month.'
                      )}
                    </span>
                  ) : (
                    <span>First month on record, nothing earlier to compare with.</span>
                  )}
                </div>
              </div>

              {tableRows.length > 0 ? (
                <TypeComparisonTable
                  rows={tableRows}
                  colorFor={(type) => legend.entryFor(type).color}
                  previousLabel={comparison?.previous.label}
                />
              ) : (
                <div style={{ textAlign: 'center', padding: '24px 20px', color: 'var(--ph-ink-4)', fontSize: 13, background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10 }}>
                  Nothing billed in {selected.label}.
                </div>
              )}
            </>
          )}
        </>
      )}
        </>
      )}
    </div>
  )
}
