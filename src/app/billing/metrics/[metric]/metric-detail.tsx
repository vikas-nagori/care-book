import { format, parseISO } from 'date-fns'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MobilePageHeader } from '@/components/layout/mobile-page-header'
import { Button } from '@/components/ui/button'
import type { AppointmentTypeBreakdownRow } from '@/lib/billing/appointment-type-breakdown'

export type MetricRow = {
  id: string
  date: string
  title: string
  meta?: string
  amount: number
}

type MetricDetailProps = {
  title: string
  subtitle: string
  total: number
  rows: MetricRow[]
  emptyLabel: string
  /** Per-appointment-type subtotals; the strip renders only when there are 2+ types to compare. */
  breakdown?: AppointmentTypeBreakdownRow[]
}

function Money({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span className={`ph-money ${className}`}>
      <span className="rs">₹</span>
      {n.toLocaleString('en-IN')}
    </span>
  )
}

// Presentational list of the records behind a billing metric tile — prop-driven and side-effect free.
export function MetricDetail({ title, subtitle, total, rows, emptyLabel, breakdown }: MetricDetailProps) {
  const showBreakdown = (breakdown?.length ?? 0) >= 2
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
        <div className="ph-stat-meta">{rows.length} record{rows.length === 1 ? '' : 's'}</div>
      </div>

      {showBreakdown && breakdown && (
        <div
          aria-label="Billed by appointment type"
          style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}
        >
          <div style={{
            padding: '9px 16px', fontSize: 10.5, color: 'var(--ph-ink-4)',
            textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600,
            borderBottom: '1px solid var(--ph-line)',
          }}>
            By appointment type
          </div>
          {breakdown.map((bucket, index) => (
            <div
              key={bucket.type}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '10px 16px',
                borderBottom: index < breakdown.length - 1 ? '1px solid var(--ph-line)' : 'none',
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 500, textTransform: 'capitalize' }}>{bucket.type}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)' }}>
                  {bucket.count} session{bucket.count === 1 ? '' : 's'}
                </span>
                <Money n={bucket.amount} />
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}>
        {rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
            {emptyLabel}
          </div>
        ) : (
          rows.map((row, index) => (
            <div
              key={row.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px',
                borderBottom: index < rows.length - 1 ? '1px solid var(--ph-line)' : 'none',
                fontSize: 13,
              }}
            >
              <div className="font-mono-data" style={{ minWidth: 72, fontSize: 11.5, color: 'var(--ph-ink-4)' }}>
                {format(parseISO(row.date), 'dd MMM')}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{row.title}</div>
                {row.meta ? (
                  <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 1, textTransform: 'capitalize' }}>{row.meta}</div>
                ) : null}
              </div>
              <Money n={row.amount} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
