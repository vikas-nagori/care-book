import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MobilePageHeader } from '@/components/layout/mobile-page-header'
import { Button } from '@/components/ui/button'
import { PaginationNav } from '@/components/pagination-nav'
import type { AppointmentTypeBreakdownRow } from '@/lib/billing/appointment-type-breakdown'
import type { DateGroup } from '@/lib/billing/date-grouped-records'
import { DateGroupList, type MetricListRow } from './date-group-list'
import { AppointmentTypeStrip } from './appointment-type-strip'
import { Money } from './money'

export type MetricRow = MetricListRow

type MetricDetailProps = {
  title: string
  subtitle: string
  total: number
  /** The date groups for the current page — pagination runs over whole dates, never part of one. */
  groups: DateGroup<MetricRow>[]
  /** Noun for one record on this metric — "session" for billed, "record" for received. */
  unitLabel: string
  emptyLabel: string
  /** Per-appointment-type subtotals; the strip renders only when there are 2+ types to compare. */
  breakdown?: AppointmentTypeBreakdownRow[]
  /** Whole-period record count (drives the "N records" meta when the list is paginated). */
  totalCount?: number
  /** Page navigation; omit for un-paginated lists. `basePath` is the metric route (e.g. /billing/metrics/received-this-month). */
  pagination?: { page: number; totalPages: number; basePath: string }
}

// Presentational view of the records behind a billing metric tile — prop-driven and side-effect free.
// The records are grouped into a collapsed accordion per date so the day-by-day totals read at a
// glance; DateGroupList owns the expand state and is the only client-side piece.
export function MetricDetail({
  title,
  subtitle,
  total,
  groups,
  unitLabel,
  emptyLabel,
  breakdown,
  totalCount,
  pagination,
}: MetricDetailProps) {
  const recordCount = totalCount ?? groups.reduce((sum, group) => sum + group.count, 0)
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
        <div className="ph-stat-label"><span>{title} · {subtitle}</span></div>
        <div className="ph-stat-value"><Money n={total} /></div>
        <div className="ph-stat-meta">{recordCount} record{recordCount === 1 ? '' : 's'}</div>
      </div>

      {/* Mirrors AppointmentTypeStrip's own 2-type floor so the spacer never outlives the strip. */}
      {breakdown && breakdown.length >= 2 && (
        <div style={{ marginBottom: 20 }}>
          <AppointmentTypeStrip breakdown={breakdown} />
        </div>
      )}

      <DateGroupList groups={groups} emptyLabel={emptyLabel} unitLabel={unitLabel} />

      {pagination && (
        <PaginationNav
          page={pagination.page}
          totalPages={pagination.totalPages}
          basePath={pagination.basePath}
          ariaLabel={`${title} pages`}
        />
      )}
    </div>
  )
}
