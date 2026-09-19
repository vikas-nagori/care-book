import type { AppointmentTypeBreakdownRow } from '@/lib/billing/appointment-type-breakdown'
import { Money } from './money'

type AppointmentTypeStripProps = {
  breakdown: AppointmentTypeBreakdownRow[]
  /**
   * Fewest types worth rendering. The billed list uses 2 — a "bifurcation" of a single type tells
   * you nothing you cannot read off the headline total. The trend's month panel uses 1, because
   * there the breakdown is the panel's whole content.
   */
  minTypes?: number
  heading?: string
}

// Per-appointment-type subtotals, shared by the billed drill-down list and the monthly trend's
// selected-month panel so both render an identical strip.
export function AppointmentTypeStrip({
  breakdown,
  minTypes = 2,
  heading = 'By appointment type',
}: AppointmentTypeStripProps) {
  if (breakdown.length < minTypes) return null

  return (
    <div
      aria-label="Billed by appointment type"
      style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}
    >
      <div style={{
        padding: '9px 16px', fontSize: 10.5, color: 'var(--ph-ink-4)',
        textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600,
        borderBottom: '1px solid var(--ph-line)',
      }}>
        {heading}
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
  )
}
