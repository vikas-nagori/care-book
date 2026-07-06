import { format, parseISO } from 'date-fns'
import { MobilePageHeader } from '@/components/layout/mobile-page-header'

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
export function MetricDetail({ title, subtitle, total, rows, emptyLabel }: MetricDetailProps) {
  return (
    <div className="px-4 pb-4 md:p-6">
      <MobilePageHeader title={title} backHref="/billing" />

      <div className="hidden md:block" style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ph-ink)' }}>
          {title}
        </h1>
        <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 2 }}>{subtitle}</div>
      </div>

      <div className="md:hidden" style={{ margin: '12px 0 16px' }}>
        <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)' }}>{subtitle}</div>
      </div>

      <div className="ph-stat mb-5">
        <div className="ph-stat-label"><span>{title} · {subtitle}</span></div>
        <div className="ph-stat-value"><Money n={total} /></div>
        <div className="ph-stat-meta">{rows.length} record{rows.length === 1 ? '' : 's'}</div>
      </div>

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
