'use client'

// Visual building blocks of the schedule calendar. The clinic schedule and the External Staff
// calendar both render through these, so the two workspaces share one look.

import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { format, isSameDay, parseISO } from 'date-fns'
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import {
  buildHours,
  computeColumns,
  computeHourRange,
  HOUR_HEIGHT,
  PX_PER_MIN,
  timeToY,
  type CalendarSlot,
} from '@/lib/schedule/calendar-layout'
import {
  getScheduleRailCenteringBehavior,
  getScheduleRailDateAccessibility,
  isScheduleDateToday,
} from '@/lib/schedule/date-range'

export type CalendarView = 'day' | 'week'

/** Today's day number sits in a filled accent circle everywhere, so it's easy to find while navigating. */
export function TodayNumber({ isToday, children, size = 26 }: { isToday: boolean; children: ReactNode; size?: number }) {
  if (!isToday) return <>{children}</>
  return (
    <span
      data-today="true"
      style={{
        display: 'inline-grid', placeItems: 'center', minWidth: size, height: size, padding: '0 4px',
        borderRadius: 999, background: 'var(--ph-accent)', color: '#fff', lineHeight: 1,
      }}
    >
      {children}
    </span>
  )
}

const navButtonStyle: CSSProperties = {
  width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 6,
  border: '1px solid var(--ph-line)', background: 'var(--ph-surface)', cursor: 'pointer',
}

/** Desktop topbar: title, Day/Week toggle, prev/today/next, date picker, then page actions. */
export function CalendarToolbar({
  title,
  selectedDate,
  view,
  onViewChange,
  onPrevious,
  onToday,
  onNext,
  onPickDate,
  actions,
}: {
  title: string
  selectedDate: Date
  view: CalendarView
  onViewChange: (view: CalendarView) => void
  onPrevious: () => void
  onToday: () => void
  onNext: () => void
  onPickDate: (date: Date) => void
  actions?: ReactNode
}) {
  const [calendarOpen, setCalendarOpen] = useState(false)
  return (
    <div className="hidden md:flex items-center justify-between gap-3 mb-5">
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ph-ink)' }}>
          {title}
        </h1>
        <div className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 2 }}>
          {format(selectedDate, 'MMM yyyy')}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="ph-toggle-group">
          <button className={`ph-toggle-opt ${view === 'day' ? 'active' : ''}`} onClick={() => onViewChange('day')}>Day</button>
          <button className={`ph-toggle-opt ${view === 'week' ? 'active' : ''}`} onClick={() => onViewChange('week')}>Week</button>
        </div>
        <button aria-label={view === 'day' ? 'Previous day' : 'Previous week'} onClick={onPrevious} style={navButtonStyle}>
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={onToday}
          style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--ph-line)', background: 'var(--ph-surface)', cursor: 'pointer', color: 'var(--ph-ink-2)' }}
        >
          Today
        </button>
        <button aria-label={view === 'day' ? 'Next day' : 'Next week'} onClick={onNext} style={navButtonStyle}>
          <ChevronRight size={14} />
        </button>
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <button aria-label="Pick a date" style={navButtonStyle}>
              <CalendarIcon size={14} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                if (date) { onPickDate(date); setCalendarOpen(false) }
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
        {actions && (
          <>
            <div style={{ width: 1, height: 20, background: 'var(--ph-line)' }} />
            {actions}
          </>
        )}
      </div>
    </div>
  )
}

/** Mobile "Jump to date" popover. */
export function JumpToDate({ selectedDate, onPickDate }: { selectedDate: Date; onPickDate: (date: Date) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex justify-end mb-2 md:hidden">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--ph-line)', background: 'var(--ph-surface)', cursor: 'pointer', color: 'var(--ph-ink-2)' }}
          >
            <CalendarIcon size={13} />
            Jump to date
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => {
              if (date) { onPickDate(date); setOpen(false) }
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

function DateChip({
  date,
  todayDate,
  selected,
  count,
  onSelect,
  buttonRef,
}: {
  date: string
  todayDate: string
  selected: boolean
  count: number
  onSelect: (date: string) => void
  buttonRef?: RefObject<HTMLButtonElement>
}) {
  const day = parseISO(date)
  const isToday = isScheduleDateToday(date, todayDate)
  const accessibility = getScheduleRailDateAccessibility(date, count, selected)
  return (
    <button
      ref={buttonRef}
      data-selected={selected}
      data-today={isToday || undefined}
      title={isToday ? 'Today' : undefined}
      aria-label={accessibility.ariaLabel}
      aria-current={accessibility.ariaCurrent}
      onClick={() => onSelect(date)}
      style={{
        minWidth: 48, padding: '8px 4px', textAlign: 'center',
        border: `1px solid ${selected ? 'var(--ph-accent)' : 'var(--ph-line)'}`,
        background: selected ? 'var(--ph-accent-soft)' : 'var(--ph-surface)',
        borderRadius: 8, cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <div style={{
        fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.04em',
        color: isToday ? 'var(--ph-accent)' : selected ? 'var(--ph-accent-ink)' : 'var(--ph-ink-4)',
        fontWeight: isToday ? 700 : undefined,
      }}>
        {format(day, 'EEE')}
      </div>
      <div className="font-mono-data" style={{
        fontSize: 15, fontWeight: 500, marginTop: 2, height: 26, display: 'grid', placeItems: 'center',
        color: selected ? 'var(--ph-accent-ink)' : 'var(--ph-ink)',
      }}>
        <TodayNumber isToday={isToday}>{format(day, 'd').padStart(2, '0')}</TodayNumber>
      </div>
      <div style={{ fontSize: 9, color: selected ? 'var(--ph-accent-ink)' : 'var(--ph-ink-4)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
        {count > 0 ? `·${count}·` : '· ·'}
      </div>
    </button>
  )
}

/** Desktop week strip of date chips. */
export function DesktopDateStrip({
  dates,
  selectedDate,
  todayDate,
  countOn,
  onSelect,
}: {
  dates: string[]
  selectedDate: string
  todayDate: string
  countOn: (date: string) => number
  onSelect: (date: string) => void
}) {
  return (
    <div className="hidden md:block">
      <div className="ph-date-strip mb-4">
        {dates.map((date) => (
          <DateChip key={date} date={date} todayDate={todayDate} selected={date === selectedDate}
            count={countOn(date)} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

/** Mobile rolling date rail that keeps the selected day centred. */
export function MobileDateRail({
  dates,
  selectedDate,
  todayDate,
  countOn,
  onSelect,
}: {
  dates: string[]
  selectedDate: string
  todayDate: string
  countOn: (date: string) => number
  onSelect: (date: string) => void
}) {
  const railRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const lastCenteredDateRef = useRef<string | null>(null)
  const lastRailWidthRef = useRef<number | null>(null)
  const railWasVisibleRef = useRef(false)

  useLayoutEffect(() => {
    const rail = railRef.current
    if (!rail) return

    const centerSelectedChip = () => {
      const selectedChip = selectedRef.current
      const railIsVisible = rail.getClientRects().length > 0
      const chipIsVisible = selectedChip != null && selectedChip.getClientRects().length > 0
      const railWidth = railIsVisible ? rail.getBoundingClientRect().width : 0
      const prefersReducedMotion = railIsVisible && chipIsVisible
        && typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const centeringBehavior = getScheduleRailCenteringBehavior({
        railIsVisible,
        chipIsVisible,
        selectedDate,
        lastCenteredDate: lastCenteredDateRef.current,
        railWidth,
        lastRailWidth: lastRailWidthRef.current,
        wasVisible: railWasVisibleRef.current,
        prefersReducedMotion,
      })

      if (!railIsVisible || !chipIsVisible) {
        railWasVisibleRef.current = false
        return
      }
      if (!selectedChip || centeringBehavior === null) return

      selectedChip.scrollIntoView({
        behavior: centeringBehavior,
        block: 'nearest',
        inline: 'center',
      })
      lastCenteredDateRef.current = selectedDate
      lastRailWidthRef.current = railWidth
      railWasVisibleRef.current = true
    }

    centerSelectedChip()

    if (typeof window === 'undefined' || typeof window.ResizeObserver !== 'function') return

    const observer = new window.ResizeObserver(centerSelectedChip)
    observer.observe(rail)

    return () => observer.disconnect()
  }, [selectedDate])

  return (
    <div className="md:hidden mb-4">
      <p className="mb-1 text-right text-[10.5px]" style={{ color: 'var(--ph-ink-4)' }}>
        Swipe the dates to change week
      </p>
      <div ref={railRef} role="region" aria-label="Schedule dates" className="ph-date-strip">
        {dates.map((date) => (
          <DateChip key={date} date={date} todayDate={todayDate} selected={date === selectedDate}
            count={countOn(date)} onSelect={onSelect} buttonRef={date === selectedDate ? selectedRef : undefined} />
        ))}
      </div>
    </div>
  )
}

/** Card header above the day timeline. */
export function DayHeader({ selectedDate, count, isToday = false, children }: {
  selectedDate: Date
  count: number
  isToday?: boolean
  children?: ReactNode
}) {
  return (
    <div style={{ padding: '10px 16px 12px', borderBottom: '1px solid var(--ph-line)', display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--ph-ink)' }}>
        {format(selectedDate, 'EEEE')}
      </div>
      <div className="font-mono-data" style={{ fontSize: 12, color: 'var(--ph-ink-3)' }}>
        {format(selectedDate, 'MMM d, yyyy')}
      </div>
      {isToday && (
        <span style={{ alignSelf: 'center', fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--ph-accent)', color: '#fff' }}>
          Today
        </span>
      )}
      <div style={{ flex: 1 }} />
      {children}
      <div style={{ fontSize: 11, color: 'var(--ph-ink-4)' }}>
        {count} appointments
      </div>
    </div>
  )
}

export type TimelineChipLayout = {
  /** Absolute geometry for the chip; spread it into the chip's style. */
  style: CSSProperties
  /** Below 40px: one row, time + name inline. */
  compact: boolean
  /** At 62px and up: room for a third line (duration · type · assignee). */
  showMeta: boolean
}

/** Hourly day timeline: time labels, hour lines and absolutely positioned chips. */
export function DayTimeline<T extends { id: string } & CalendarSlot>({
  items,
  renderChip,
}: {
  items: readonly T[]
  renderChip: (item: T, layout: TimelineChipLayout) => ReactNode
}) {
  const columns = computeColumns(items)
  // Visible hour window — expands beyond 7am–10pm when the day has out-of-hours bookings.
  const { startHour, endHour } = computeHourRange(items)
  const hours = buildHours(startHour, endHour)
  const height = (endHour - startHour + 1) * HOUR_HEIGHT
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr' }}>
      {/* Time labels */}
      <div style={{ position: 'relative', height }}>
        {hours.map((h, i) => (
          <div key={h.label} style={{
            position: 'absolute',
            top: i * HOUR_HEIGHT + 2,
            right: 6,
            fontSize: 10,
            color: 'var(--ph-ink-4)',
            fontFamily: 'var(--font-mono)',
            lineHeight: 1,
            userSelect: 'none',
          }}>
            {h.label}
          </div>
        ))}
      </div>
      {/* Appointment canvas */}
      <div style={{ position: 'relative', height, borderLeft: '1px solid var(--ph-line)' }}>
        {hours.map((_h, i) => (
          <div key={i} style={{
            position: 'absolute',
            top: i * HOUR_HEIGHT,
            left: 0, right: 0,
            borderTop: '1px solid var(--ph-line)',
            pointerEvents: 'none',
          }} />
        ))}
        {items.map((item) => {
          const info = columns.get(item.id) ?? { column: 0, totalColumns: 1 }
          const top = timeToY(item.time.slice(0, 5), startHour)
          const chipHeight = Math.max(item.duration_minutes * PX_PER_MIN, 24)
          const widthPct = 100 / info.totalColumns
          const leftPct = info.column * widthPct
          // Three size tiers so text never clips:
          //  - compact  (< 40px): single row, time + name inline (tiny slots)
          //  - medium   (40–61px): two lines, time + name, no meta (e.g. 30-min = 50px)
          //  - tall     (>= 62px): three lines incl. duration · type · assignee
          const compact = chipHeight < 40
          const showMeta = chipHeight >= 62
          return (
            <Fragment key={item.id}>
              {renderChip(item, {
                compact,
                showMeta,
                style: {
                  position: 'absolute',
                  top: top + 1,
                  height: chipHeight - 2,
                  left: `calc(${leftPct}% + 3px)`,
                  width: `calc(${widthPct}% - 6px)`,
                  padding: compact ? '2px 6px' : '5px 8px',
                  margin: 0,
                  overflow: 'hidden',
                  boxSizing: 'border-box',
                  flexDirection: compact ? 'row' : 'column',
                  alignItems: compact ? 'center' : 'flex-start',
                  gap: compact ? 4 : 2,
                  textDecoration: 'none',
                  color: 'inherit',
                },
              })}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

/** Standard chip body: time, title, and an optional meta line when the chip is tall enough. */
export function TimelineChipContent({
  timeLabel,
  title,
  inlineSuffix,
  meta,
  layout,
}: {
  timeLabel: string
  title: string
  inlineSuffix?: string | null
  meta: string
  layout: TimelineChipLayout
}) {
  const { compact, showMeta } = layout
  return (
    <>
      <span className="font-mono-data" style={{ fontSize: 10, lineHeight: 1.2, color: 'var(--ph-ink-3)', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: compact ? undefined : '100%' }}>
        {timeLabel}
      </span>
      <span style={{ fontSize: compact ? 11 : 12.5, lineHeight: 1.2, fontWeight: 500, color: 'var(--ph-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', minWidth: 0 }}>
        {title}
        {!showMeta && inlineSuffix && ` · ${inlineSuffix}`}
      </span>
      {showMeta && (
        <span style={{ fontSize: 10.5, lineHeight: 1.2, color: 'var(--ph-ink-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
          {meta}
        </span>
      )}
    </>
  )
}

/** Week grid: one column per day, one row per hour, chips listed in their hour cell. */
export function WeekGrid<T extends { id: string; date: string } & CalendarSlot>({
  weekDays,
  todayDate,
  items,
  renderItem,
}: {
  weekDays: Date[]
  todayDate: string
  items: readonly T[]
  renderItem: (item: T) => ReactNode
}) {
  const { startHour, endHour } = computeHourRange(items)
  const hours = buildHours(startHour, endHour)
  return (
    <div style={{ overflowX: 'auto' }} className="ph-scroll">
      <div style={{
        display: 'grid',
        gridTemplateColumns: '52px repeat(7, 1fr)',
        border: '1px solid var(--ph-line)',
        borderRadius: 10,
        overflow: 'hidden',
        background: 'var(--ph-surface)',
        minWidth: 640,
      }}>
        <div style={{ borderBottom: '1px solid var(--ph-line)', background: 'var(--ph-surface)' }} />
        {weekDays.map((day, i) => {
          const isToday = isScheduleDateToday(format(day, 'yyyy-MM-dd'), todayDate)
          return (
            <div
              key={i}
              style={{
                padding: '10px 6px', borderBottom: '1px solid var(--ph-line)',
                fontSize: 11, textAlign: 'center',
                color: isToday ? 'var(--ph-accent)' : 'var(--ph-ink-3)',
                fontWeight: isToday ? 600 : 400,
                borderLeft: '1px solid var(--ph-line)',
              }}
            >
              <div style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{format(day, 'EEE')}</div>
              <div className="font-mono-data" style={{ fontSize: 15, fontWeight: 500, marginTop: 2, height: 28, display: 'grid', placeItems: 'center', color: 'var(--ph-ink)' }}>
                <TodayNumber isToday={isToday} size={28}>{format(day, 'd')}</TodayNumber>
              </div>
            </div>
          )
        })}
        {hours.map((h) => (
          <Fragment key={h.label}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ph-ink-4)',
              padding: '6px 6px', textAlign: 'right',
              borderBottom: '1px solid var(--ph-line)',
            }}>
              {h.label}
            </div>
            {weekDays.map((day, di) => {
              const slotItems = items.filter((item) => isSameDay(parseISO(item.date), day) && item.time.startsWith(h.hh))
              return (
                <div key={`${h.label}-${di}`} style={{
                  borderLeft: '1px solid var(--ph-line)', borderBottom: '1px solid var(--ph-line)',
                  minHeight: 44, padding: 4, fontSize: 10.5,
                }}>
                  {slotItems.map((item) => <Fragment key={item.id}>{renderItem(item)}</Fragment>)}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
