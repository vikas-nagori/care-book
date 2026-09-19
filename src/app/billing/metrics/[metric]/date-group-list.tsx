'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronDown } from 'lucide-react'
import type { DateGroup, DateGroupedRow } from '@/lib/billing/date-grouped-records'
import { Money } from './money'

/** A drill-down record as the list renders it. */
export type MetricListRow = DateGroupedRow & {
  title: string
  meta?: string
}

type DateGroupListProps = {
  groups: DateGroup<MetricListRow>[]
  emptyLabel: string
  /** Noun for one record on this metric — "session" for billed, "record" for received. */
  unitLabel: string
}

// Collapsed-by-default accordion, one row per date. The header carries the day's own total so the
// list reads as a day-by-day summary at a glance; expanding a date reveals the records behind it.
// Several dates can be open at once, and nothing is fetched on expand — the rows are already here.
export function DateGroupList({ groups, emptyLabel, unitLabel }: DateGroupListProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  function toggle(date: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(date)) next.add(date)
      return next
    })
  }

  return (
    <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}>
      {groups.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
          {emptyLabel}
        </div>
      ) : (
        groups.map((group, index) => {
          const isOpen = expanded.has(group.date)
          const panelId = `date-group-${group.date}`
          return (
            <div
              key={group.date}
              style={{ borderBottom: index < groups.length - 1 ? '1px solid var(--ph-line)' : 'none' }}
            >
              <button
                type="button"
                onClick={() => toggle(group.date)}
                aria-expanded={isOpen}
                aria-controls={panelId}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                  padding: '12px 16px', minHeight: 44, background: 'none', border: 'none',
                  font: 'inherit', fontSize: 13, color: 'inherit', textAlign: 'left', cursor: 'pointer',
                }}
              >
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  style={{
                    flexShrink: 0, color: 'var(--ph-ink-4)',
                    transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                    transition: 'transform 120ms ease',
                  }}
                />
                <span className="font-mono-data" style={{ minWidth: 72, fontSize: 11.5, color: 'var(--ph-ink-4)' }}>
                  {group.label}
                </span>
                <span style={{ flex: 1, minWidth: 0 }} />
                <span className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)' }}>
                  {group.count} {unitLabel}{group.count === 1 ? '' : 's'}
                </span>
                <Money n={group.total} />
              </button>

              {isOpen && (
                <div id={panelId}>
                  {group.rows.map((row) => (
                    <div
                      key={row.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        padding: '10px 16px 10px 42px',
                        borderTop: '1px solid var(--ph-line)',
                        fontSize: 13,
                      }}
                    >
                      <div className="font-mono-data" style={{ minWidth: 56, fontSize: 11.5, color: 'var(--ph-ink-4)' }}>
                        {format(parseISO(row.date), 'dd MMM')}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500 }}>{row.title}</div>
                        {row.meta ? (
                          <div style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 1, textTransform: 'capitalize' }}>
                            {row.meta}
                          </div>
                        ) : null}
                      </div>
                      <Money n={row.amount} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
