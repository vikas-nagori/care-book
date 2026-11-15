import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { AppointmentTypeBreakdownRow } from '@/lib/billing/appointment-type-breakdown'
import {
  deltaDirection,
  formatPercent,
  type MonthDelta,
  type TypeComparisonRow,
} from '@/lib/billing/billed-month-comparison'
import { Money } from './money'

// The monthly trend's month panel pieces: a change-vs-last-month badge, and the per-appointment-type
// table with each type's own change. Up is good here (more billed), so up wears the "ok" colour and
// down the "bad" colour — always with an arrow and a signed figure, never colour alone.

const DIRECTION_STYLE = {
  up: { color: 'var(--ph-ok)', Icon: ArrowUpRight, word: 'up' },
  down: { color: 'var(--ph-bad)', Icon: ArrowDownRight, word: 'down' },
  flat: { color: 'var(--ph-ink-4)', Icon: Minus, word: 'no change' },
} as const

export function DeltaBadge({ delta, against }: { delta: MonthDelta; against: string }) {
  const direction = deltaDirection(delta)
  if (direction === 'none') return null
  if (direction === 'new' || delta.kind !== 'change') {
    return (
      <span data-delta="new" aria-label={`new since ${against}`} style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ph-info)' }}>
        New
      </span>
    )
  }
  const { color, Icon, word } = DIRECTION_STYLE[direction]
  const text = formatPercent(delta.percent)
  return (
    <span
      data-delta={direction}
      aria-label={direction === 'flat' ? `no change on ${against}` : `${word} ${text.replace(/^[+−]/, '')} on ${against}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11.5, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
    >
      <Icon aria-hidden size={13} strokeWidth={2.4} />
      {text}
    </span>
  )
}

/** `+₹17,000` / `−₹4,500`, for the absolute change beside a percentage. */
export function signedRupees(difference: number): string {
  const n = Math.round(difference)
  return `${n < 0 ? '−' : '+'}₹${Math.abs(n).toLocaleString('en-IN')}`
}

type Row = AppointmentTypeBreakdownRow & { delta?: MonthDelta }

export function TypeComparisonTable({
  rows,
  colorFor,
  previousLabel,
}: {
  rows: Array<TypeComparisonRow | AppointmentTypeBreakdownRow>
  colorFor: (type: string) => string
  /** The month compared against; when absent, rows show amounts only. */
  previousLabel?: string
}) {
  const typed = rows as Row[]
  return (
    <div
      aria-label="Billed by appointment type"
      style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}
    >
      <div style={{
        display: 'flex', justifyContent: 'space-between', gap: 12,
        padding: '9px 16px', fontSize: 10.5, color: 'var(--ph-ink-4)',
        textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600,
        borderBottom: '1px solid var(--ph-line)',
      }}>
        <span>By appointment type</span>
        {previousLabel && <span style={{ textTransform: 'none', letterSpacing: 0 }}>vs {previousLabel}</span>}
      </div>
      {typed.map((row, index) => (
        <div
          key={row.type}
          data-type-row={row.type}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '10px 16px',
            borderBottom: index < typed.length - 1 ? '1px solid var(--ph-line)' : 'none',
            fontSize: 13,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
            <span aria-hidden data-type-swatch style={{ width: 10, height: 10, borderRadius: 2, background: colorFor(row.type), flex: 'none', marginTop: 4 }} />
            <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 500, textTransform: 'capitalize' }}>{row.type}</span>
              <span className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)' }}>
                {row.count} session{row.count === 1 ? '' : 's'}
              </span>
            </span>
          </span>
          <span style={{ display: 'grid', justifyItems: 'end', gap: 2, flex: 'none' }}>
            <Money n={row.amount} />
            {previousLabel && row.delta && <DeltaBadge delta={row.delta} against={previousLabel} />}
          </span>
        </div>
      ))}
    </div>
  )
}
