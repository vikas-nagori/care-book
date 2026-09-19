'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MobilePageHeader } from '@/components/layout/mobile-page-header'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { BilledMonthPoint } from '@/lib/billing/monthly-billed-series'
import { BilledTrendChart } from './billed-trend-chart'
import { AppointmentTypeStrip } from './appointment-type-strip'
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
  /** Day of the month the "billed till date" view cuts off at (today's day of month). */
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

  const total = useMemo(() => series.reduce((sum, point) => sum + point.amount, 0), [series])
  const headline = mode === 'full' ? 'Total billed · all time' : `Total billed · first ${tillDay} days of each month`
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
      <div className="ph-stat mb-5">
        <div className="ph-stat-label"><span>{headline}</span></div>
        <div className="ph-stat-value"><Money n={total} /></div>
        <div className="ph-stat-meta">{series.length} month{series.length === 1 ? '' : 's'}</div>
      </div>

      {series.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13, background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10 }}>
          No billed sessions yet.
        </div>
      ) : (
        <>
          <BilledTrendChart series={series} selectedMonth={selected?.month} />

          <div className="ph-tabs" style={{ marginTop: 16 }} role="group" aria-label="Trend range">
            <button
              type="button"
              className={`ph-tab ${mode === 'full' ? 'active' : ''}`}
              aria-pressed={mode === 'full'}
              onClick={() => setMode('full')}
              style={{ minHeight: 44 }}
            >
              Full month
            </button>
            <button
              type="button"
              className={`ph-tab ${mode === 'tillDate' ? 'active' : ''}`}
              aria-pressed={mode === 'tillDate'}
              onClick={() => setMode('tillDate')}
              style={{ minHeight: 44 }}
            >
              Billed till date
            </button>
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', margin: '8px 0 16px' }}>
            {mode === 'full'
              ? 'Every month counted in full.'
              : `Every month counted to day ${tillDay} only, so months compare like for like.`}
          </div>

          <div style={{ marginBottom: 12 }}>
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
                  {mode === 'full' ? 'whole month' : `first ${tillDay} days`}
                </div>
              </div>

              {selected.breakdown.length > 0 ? (
                <AppointmentTypeStrip breakdown={selected.breakdown} minTypes={1} />
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
