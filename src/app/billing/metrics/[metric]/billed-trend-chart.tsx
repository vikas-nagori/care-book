import type { BilledMonthPoint } from '@/lib/billing/monthly-billed-series'

// Single-series month-by-month "total billed" line chart. Hand-rolled SVG (no chart lib): per-point
// native <title> tooltips stand in for a JS hover layer. Colors come from the design-system CSS
// tokens (accent for the one series, ink/line tokens for all text + grid) so it adapts to light/dark
// automatically. The chart is a fixed pixel width and scrolls horizontally when there are many
// months. `selectedMonth` emphasises the point the month picker is currently sitting on.

const PX_PER_POINT = 60
const MARGIN = { top: 16, right: 24, bottom: 40, left: 64 }
const PLOT_HEIGHT = 200
const HEIGHT = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom
const Y_TICKS = 4

/** Round up to a clean 1/2/5 × 10ⁿ ceiling so gridline labels are readable round numbers. */
function niceCeil(value: number): number {
  if (value <= 0) return 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)))
  const normalized = value / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * magnitude
}

function rupees(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

export function BilledTrendChart({
  series,
  selectedMonth,
}: {
  series: BilledMonthPoint[]
  selectedMonth?: string
}) {
  const plotWidth = Math.max(1, series.length - 1) * PX_PER_POINT
  const width = MARGIN.left + plotWidth + MARGIN.right
  const rawMax = Math.max(1, ...series.map((p) => p.amount))
  const yMax = niceCeil(rawMax)

  const x = (index: number) =>
    MARGIN.left + (series.length <= 1 ? plotWidth / 2 : index * PX_PER_POINT)
  const y = (amount: number) => MARGIN.top + PLOT_HEIGHT * (1 - amount / yMax)

  const points = series.map((point, index) => ({ ...point, cx: x(index), cy: y(point.amount) }))
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.cx} ${p.cy}`).join(' ')
  const areaPath = points.length
    ? `${linePath} L ${points[points.length - 1].cx} ${MARGIN.top + PLOT_HEIGHT} L ${points[0].cx} ${MARGIN.top + PLOT_HEIGHT} Z`
    : ''

  const yTicks = Array.from({ length: Y_TICKS + 1 }, (_, i) => (yMax / Y_TICKS) * i)

  return (
    <div style={{ overflowX: 'auto', background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, padding: '12px 4px 4px' }}>
      <svg
        role="img"
        aria-label="Monthly total billed trend"
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        style={{ display: 'block' }}
      >
        {/* Horizontal gridlines + y-axis value labels */}
        {yTicks.map((tick, i) => {
          const gy = y(tick)
          return (
            <g key={`tick-${i}`}>
              <line x1={MARGIN.left} y1={gy} x2={width - MARGIN.right} y2={gy} stroke="var(--ph-line)" strokeWidth={1} />
              <text x={MARGIN.left - 8} y={gy + 3.5} textAnchor="end" fontSize={10.5} fill="var(--ph-ink-4)">
                {rupees(tick)}
              </text>
            </g>
          )
        })}

        {/* Area fill under the line */}
        {areaPath && <path d={areaPath} fill="var(--ph-accent)" fillOpacity={0.1} stroke="none" />}
        {/* The trend line */}
        <path d={linePath} fill="none" stroke="var(--ph-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* Point markers (≥8px) with native hover tooltips + x-axis month labels */}
        {points.map((p) => {
          const isSelected = p.month === selectedMonth
          return (
          <g key={p.month} data-month={p.month}>
            <circle
              cx={p.cx}
              cy={p.cy}
              r={isSelected ? 6 : 4}
              fill={isSelected ? 'var(--ph-accent)' : 'var(--ph-surface)'}
              stroke="var(--ph-accent)"
              strokeWidth={2}
              data-selected={isSelected ? 'true' : 'false'}
            >
              <title>{`${p.label} · ${rupees(p.amount)}`}</title>
            </circle>
            <text
              x={p.cx}
              y={HEIGHT - 14}
              textAnchor="middle"
              fontSize={10.5}
              fontWeight={isSelected ? 600 : 400}
              fill={isSelected ? 'var(--ph-ink)' : 'var(--ph-ink-4)'}
            >
              {p.label}
            </text>
          </g>
          )
        })}
      </svg>
    </div>
  )
}
