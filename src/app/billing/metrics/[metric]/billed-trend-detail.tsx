import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MobilePageHeader } from '@/components/layout/mobile-page-header'
import { Button } from '@/components/ui/button'
import type { BilledMonthPoint } from '@/lib/billing/monthly-billed-series'
import { BilledTrendChart } from './billed-trend-chart'

type BilledTrendDetailProps = {
  title: string
  subtitle: string
  /** All-time total billed (sum across every month in the series). */
  total: number
  series: BilledMonthPoint[]
}

function Money({ n }: { n: number }) {
  return (
    <span className="ph-money">
      <span className="rs">₹</span>
      {n.toLocaleString('en-IN')}
    </span>
  )
}

// The Billed drill-down as a month-by-month trendline instead of a record list.
export function BilledTrendDetail({ title, subtitle, total, series }: BilledTrendDetailProps) {
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

      <div className="ph-stat mb-5">
        <div className="ph-stat-label"><span>Total billed · all time</span></div>
        <div className="ph-stat-value"><Money n={total} /></div>
        <div className="ph-stat-meta">{series.length} month{series.length === 1 ? '' : 's'}</div>
      </div>

      {series.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13, background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10 }}>
          No billed sessions yet.
        </div>
      ) : (
        <BilledTrendChart series={series} />
      )}
    </div>
  )
}
