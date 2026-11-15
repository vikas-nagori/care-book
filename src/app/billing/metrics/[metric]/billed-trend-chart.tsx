'use client'

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { BilledMonthPoint } from '@/lib/billing/monthly-billed-series'
import {
  buildTypeLegend,
  buildValueAxis,
  compactRupees,
  fullRupees,
  stackMonth,
  type StackSegment,
  type TypeLegend,
} from '@/lib/billing/billed-trend-chart-model'

// Month-by-month billed amount: a column per month stacked by appointment type, with a line
// through the stack tops for the month's total. Everything shares one ₹ axis: the stack *is* the
// total, so a second axis for the line would only float it off its own bar.
//
// Hand-rolled SVG (no chart library). Built for the iOS home-screen app first: a tap on a month
// pins a readout of its total and per-type amounts (iOS never shows SVG <title> tooltips) and
// moves the month picker below to it; a tap anywhere else dismisses it. A mouse gets the same
// readout on hover, a keyboard on focus. The readout only repeats what the month panel shows, so
// no value is reachable through hover alone.

// Month columns stretch to fill the phone's width; past what fits, the plot scrolls sideways while
// the ₹ axis stays pinned on the left, so a scrolled chart never loses its scale.
const MIN_SLOT = 48 // px per month at most squeezed; also the tap target width, over 44px
const MAX_SLOT = 72
const FALLBACK_SLOT = 56 // before the container has been measured (server render, tests)
const AXIS_WIDTH = 46
const BAR = 24
const GAP = 2 // surface gap between stacked segments
const MARGIN = { top: 26, right: 4, bottom: 30, left: 4 }
const PLOT_HEIGHT = 200
const HEIGHT = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom
const MIN_PLOT_WIDTH = 200 // keeps room for the readout beside a lone month
const TOOLTIP_WIDTH = 184
const TOTAL_INK = 'var(--ph-ink-2)'

type Column = {
  point: BilledMonthPoint
  index: number
  cx: number
  cy: number
  segments: StackSegment[]
}

function topRoundedBar(x: number, yTop: number, yBottom: number, width: number): string {
  const r = Math.min(4, yBottom - yTop, width / 2)
  const x1 = x + width
  return `M ${x} ${yBottom} L ${x} ${yTop + r} Q ${x} ${yTop} ${x + r} ${yTop} L ${x1 - r} ${yTop} Q ${x1} ${yTop} ${x1} ${yTop + r} L ${x1} ${yBottom} Z`
}

function describeMonth(column: Column): string {
  const parts = column.segments
    .slice()
    .reverse()
    .map((segment) => `${segment.type} ${fullRupees(segment.amount)}`)
  return `${column.point.label}: total ${fullRupees(column.point.amount)}${parts.length ? `. ${parts.join(', ')}` : ', nothing billed'}`
}

export function BilledTrendChart({
  series,
  legend: legendProp,
  selectedMonth,
  onSelectMonth,
}: {
  series: BilledMonthPoint[]
  /** Colour assignment; pass the full-history legend so colours survive a range switch. */
  legend?: TypeLegend
  selectedMonth?: string
  onSelectMonth?: (month: string) => void
}) {
  const legend = useMemo(() => legendProp ?? buildTypeLegend(series), [legendProp, series])

  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewWidth, setViewWidth] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const available = Math.max(0, viewWidth - MARGIN.left - MARGIN.right)
  const slot = viewWidth > 0
    ? Math.min(MAX_SLOT, Math.max(MIN_SLOT, available / Math.max(1, series.length)))
    : FALLBACK_SLOT
  const plotWidth = Math.max(series.length * slot, available, MIN_PLOT_WIDTH)
  const offset = (plotWidth - series.length * slot) / 2
  const width = MARGIN.left + plotWidth + MARGIN.right
  const axis = buildValueAxis(Math.max(0, ...series.map((point) => point.amount)))
  const y = (amount: number) => MARGIN.top + PLOT_HEIGHT * (1 - amount / axis.max)
  const baseline = MARGIN.top + PLOT_HEIGHT

  const columns: Column[] = series.map((point, index) => {
    const cx = MARGIN.left + offset + slot * index + slot / 2
    return { point, index, cx, cy: y(point.amount), segments: stackMonth(point, legend) }
  })
  const linePath = columns.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.cx} ${c.cy}`).join(' ')

  // Only the types drawn in this range get a legend entry, in stacking order.
  const drawnTypes = new Set(columns.flatMap((column) => column.segments.map((segment) => segment.type)))
  const legendEntries = legend.entries.filter((entry) => drawnTypes.has(entry.type))

  // Readout: a mouse hover wins, then keyboard focus, then a tapped (pinned) month.
  const [hovered, setHovered] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const activeMonth = hovered ?? focused ?? pinned
  const active = columns.find((column) => column.point.month === activeMonth) ?? null

  const wrapperRef = useRef<HTMLDivElement>(null)
  const hitRefs = useRef<Array<SVGRectElement | null>>([])
  // A tap focuses the tapped element too; remember the press so that focus isn't mistaken for
  // keyboard focus (which would keep the readout open after a second tap closes it).
  const lastPointerDown = useRef(0)

  // A tap anywhere outside the chart dismisses a pinned readout.
  useEffect(() => {
    if (!pinned) return
    const dismiss = (event: globalThis.PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setPinned(null)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [pinned])

  // Keep the selected month in view: on open that is the newest month, at the right-hand end of a
  // long history; after a pick from the month picker it may be scrolled out of sight.
  const selectedIndex = series.findIndex((point) => point.month === selectedMonth)
  const selectedCx = selectedIndex >= 0 ? MARGIN.left + offset + slot * selectedIndex + slot / 2 : null
  useEffect(() => {
    const el = scrollRef.current
    if (!el || selectedCx === null) return
    if (selectedCx - slot / 2 < el.scrollLeft || selectedCx + slot / 2 > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = Math.max(0, selectedCx - el.clientWidth / 2)
    }
  }, [selectedCx, slot, width])

  function choose(month: string) {
    onSelectMonth?.(month)
    setPinned((current) => (current === month ? null : month))
  }

  function onHitKeyDown(event: KeyboardEvent<SVGRectElement>, column: Column) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(column.point.month)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const next = column.index + (event.key === 'ArrowRight' ? 1 : -1)
      hitRefs.current[next]?.focus()
    } else if (event.key === 'Escape') {
      setPinned(null)
      setFocused(null)
    }
  }

  function onHitPointer(event: PointerEvent<SVGRectElement>, month: string) {
    if (event.pointerType === 'mouse') setHovered(month)
  }

  let tooltipLeft = 0
  if (active) {
    const right = active.cx + slot / 2 + 4
    const left = active.cx - slot / 2 - 4 - TOOLTIP_WIDTH
    tooltipLeft = right + TOOLTIP_WIDTH <= width ? right : Math.max(0, left)
  }

  return (
    <div
      ref={wrapperRef}
      style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, padding: '10px 4px 4px' }}
    >
      <ul
        aria-label="Chart legend"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', listStyle: 'none', margin: 0, padding: '0 10px 6px' }}
      >
        {legendEntries.map((entry) => (
          <li key={entry.type} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ph-ink-2)', textTransform: 'capitalize' }}>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: entry.color, flex: 'none' }} />
            {entry.type}
          </li>
        ))}
        <li style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ph-ink-2)' }}>
          <span aria-hidden style={{ width: 14, height: 2, borderRadius: 1, background: TOTAL_INK, flex: 'none' }} />
          Total
        </li>
      </ul>

      <div style={{ display: 'flex' }}>
      <svg aria-hidden width={AXIS_WIDTH} height={HEIGHT} style={{ display: 'block', flex: 'none' }}>
        {axis.ticks.map((tick) => (
          <text key={`label-${tick}`} x={AXIS_WIDTH - 6} y={y(tick) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--ph-ink-4)" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {compactRupees(tick)}
          </text>
        ))}
      </svg>
      <div ref={scrollRef} data-chart-scroll style={{ overflowX: 'auto', overflowY: 'hidden', flex: '1 1 auto', minWidth: 0 }}>
        <div style={{ position: 'relative', width, height: HEIGHT }}>
          <svg
            role="group"
            aria-label="Monthly total billed trend"
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            style={{ display: 'block', WebkitTapHighlightColor: 'transparent' }}
            onPointerLeave={(event) => {
              if (event.pointerType === 'mouse') setHovered(null)
            }}
          >
            {/* The selected month's column band sits behind everything else. */}
            {columns
              .filter((column) => column.point.month === selectedMonth)
              .map((column) => (
                <rect
                  key="selected-band"
                  x={column.cx - slot / 2 + 3}
                  y={4}
                  width={slot - 6}
                  height={baseline + 22}
                  rx={6}
                  fill="var(--ph-bg-soft)"
                />
              ))}

            {/* Gridlines; their ₹ labels live in the pinned axis beside the scroller. */}
            {axis.ticks.map((tick) => (
              <line key={`tick-${tick}`} x1={0} y1={y(tick)} x2={width} y2={y(tick)} stroke="var(--ph-line)" strokeWidth={1} />
            ))}

            {/* Stacked columns: largest all-time type on the baseline, 2px surface gap between parts,
                rounded only at the data end. A part too thin to draw still shows in the readout. */}
            {columns.map((column) => {
              let running = 0
              const dimmed = active !== null && active.point.month !== column.point.month
              return (
                <g key={`bar-${column.point.month}`} data-bar-month={column.point.month} opacity={dimmed ? 0.4 : 1} style={{ transition: 'opacity 120ms' }}>
                  {column.segments.map((segment, k) => {
                    const bottom = y(running) - (k === 0 ? 0 : GAP)
                    running += segment.amount
                    const top = y(running)
                    if (bottom - top <= 0) return null
                    const x = column.cx - BAR / 2
                    return k === column.segments.length - 1 ? (
                      <path key={segment.type} data-segment={segment.type} d={topRoundedBar(x, top, bottom, BAR)} fill={segment.color} />
                    ) : (
                      <rect key={segment.type} data-segment={segment.type} x={x} y={top} width={BAR} height={bottom - top} fill={segment.color} />
                    )
                  })}
                </g>
              )
            })}

            {/* The total line runs through each stack's top. */}
            <path d={linePath} fill="none" stroke={TOTAL_INK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

            {columns.map((column) => {
              const isSelected = column.point.month === selectedMonth
              return (
                <g key={column.point.month} data-month={column.point.month}>
                  <circle
                    cx={column.cx}
                    cy={column.cy}
                    r={isSelected ? 5 : 4}
                    fill={TOTAL_INK}
                    stroke="var(--ph-surface)"
                    strokeWidth={2}
                    data-selected={isSelected ? 'true' : 'false'}
                  />
                  {isSelected && (
                    <text
                      data-total-label
                      x={column.cx}
                      y={column.cy - 10}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill="var(--ph-ink)"
                      // A halo in the selected band's colour keeps the line from striking through it.
                      stroke="var(--ph-bg-soft)"
                      strokeWidth={4}
                      strokeLinejoin="round"
                      paintOrder="stroke"
                    >
                      {compactRupees(column.point.amount)}
                    </text>
                  )}
                  <text
                    x={column.cx}
                    y={baseline + 18}
                    textAnchor="middle"
                    fontSize={10.5}
                    fontWeight={isSelected ? 600 : 400}
                    fill={isSelected ? 'var(--ph-ink)' : 'var(--ph-ink-4)'}
                  >
                    {column.point.label}
                  </text>
                </g>
              )
            })}

            {/* Whole-column hit targets on top: the full slot width and height, not the painted bar. */}
            {columns.map((column) => (
              <rect
                key={`hit-${column.point.month}`}
                ref={(el) => {
                  hitRefs.current[column.index] = el
                }}
                role="button"
                tabIndex={0}
                aria-label={describeMonth(column)}
                aria-pressed={column.point.month === selectedMonth}
                data-hit-month={column.point.month}
                x={column.cx - slot / 2}
                y={0}
                width={slot}
                height={HEIGHT}
                fill="transparent"
                style={{ cursor: 'pointer', outline: 'none' }}
                onPointerDown={() => {
                  lastPointerDown.current = Date.now()
                }}
                onPointerEnter={(event) => onHitPointer(event, column.point.month)}
                onPointerMove={(event) => onHitPointer(event, column.point.month)}
                onClick={() => choose(column.point.month)}
                onFocus={() => {
                  if (Date.now() - lastPointerDown.current > 800) setFocused(column.point.month)
                }}
                onBlur={() => setFocused(null)}
                onKeyDown={(event) => onHitKeyDown(event, column)}
              />
            ))}

            {/* Keyboard focus ring, drawn by hand because SVG rects ignore :focus-visible outlines. */}
            {focused &&
              columns
                .filter((column) => column.point.month === focused)
                .map((column) => (
                  <rect
                    key="focus-ring"
                    x={column.cx - slot / 2 + 2}
                    y={3}
                    width={slot - 4}
                    height={baseline + 24}
                    rx={6}
                    fill="none"
                    stroke="var(--ph-accent)"
                    strokeWidth={2}
                    pointerEvents="none"
                  />
                ))}
          </svg>

          {active && <ChartReadout column={active} left={tooltipLeft} />}
        </div>
      </div>
      </div>
    </div>
  )
}

function ChartReadout({ column, left }: { column: Column; left: number }) {
  // Top segment first, so the list reads in the same order as the stack.
  const rows = column.segments.slice().reverse()
  return (
    <div
      data-chart-readout
      aria-hidden
      style={{
        position: 'absolute',
        top: 2,
        left,
        width: TOOLTIP_WIDTH,
        pointerEvents: 'none',
        background: 'var(--ph-surface)',
        border: '1px solid var(--ph-line-strong)',
        borderRadius: 8,
        boxShadow: '0 4px 14px rgba(26, 24, 20, 0.12)',
        padding: '8px 10px',
        fontSize: 12,
        zIndex: 2,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--ph-ink-4)', marginBottom: 4 }}>{column.point.label}</div>
      <ReadoutRow keyColor={TOTAL_INK} value={fullRupees(column.point.amount)} name="Total" strong />
      {rows.length > 0 ? (
        <div style={{ borderTop: '1px solid var(--ph-line)', marginTop: 5, paddingTop: 5, display: 'grid', gap: 3 }}>
          {rows.map((segment) => (
            <ReadoutRow key={segment.type} keyColor={segment.color} value={fullRupees(segment.amount)} name={segment.type} />
          ))}
        </div>
      ) : (
        <div style={{ color: 'var(--ph-ink-4)', marginTop: 4 }}>Nothing billed</div>
      )}
    </div>
  )
}

function ReadoutRow({ keyColor, value, name, strong = false }: { keyColor: string; value: string; name: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
      <span aria-hidden style={{ width: 10, height: 3, borderRadius: 2, background: keyColor, flex: 'none' }} />
      <span
        style={{ fontWeight: strong ? 700 : 600, color: 'var(--ph-ink)', fontVariantNumeric: 'tabular-nums', flex: 'none' }}
      >
        {value}
      </span>
      <span style={{ color: 'var(--ph-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
        {name}
      </span>
    </div>
  )
}
