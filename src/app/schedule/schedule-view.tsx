'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { format, addDays, startOfWeek, isSameDay, parseISO } from 'date-fns'
import { CalendarIcon, Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { AppointmentForm } from './appointment-form'
import type { Appointment, AppointmentAssigneeOption, ExternalStaff } from '@/lib/supabase/types'
import Link from 'next/link'
import { formatTime12 } from '@/lib/format-time'
import {
  APPOINTMENT_TYPE_LABEL,
  APPOINTMENT_TYPE_SHORT_LABEL,
  isHomeVisitType,
  type AppointmentType,
} from '@/lib/appointments/appointment-type'

// Per-type accent colors for chips and week cells (token names from globals.css).
const TYPE_BORDER_COLOR: Record<AppointmentType, string> = {
  clinic: 'var(--ph-accent)',
  home_visit: 'var(--ph-warn)',
  clinic_home_visit: 'var(--ph-info)',
}
const TYPE_BG_COLOR: Record<AppointmentType, string> = {
  clinic: 'var(--ph-accent-soft)',
  home_visit: 'var(--ph-warn-soft)',
  clinic_home_visit: 'var(--ph-info-soft)',
}
const TYPE_FG_COLOR: Record<AppointmentType, string> = {
  clinic: 'var(--ph-accent-ink)',
  home_visit: 'var(--ph-warn)',
  clinic_home_visit: 'var(--ph-info)',
}

interface ScheduleViewProps {
  initialAppointments: (Pick<Appointment, 'id' | 'date' | 'time' | 'duration_minutes' | 'type' | 'status'> & {
    payment_status?: Appointment['payment_status']
    assigned_to?: string | null
    external_staff_id?: string | null
    fee?: number | null
    patient: { id: string; name: string; phone: string } | null
    external_staff?: Pick<ExternalStaff, 'id' | 'name' | 'phone' | 'status' | 'linked_profile_id'> | null
  })[]
  patients: { id: string; name: string }[]
  assigneeOptions: AppointmentAssigneeOption[]
  externalStaffOptions: ExternalStaff[]
  currentProfileId: string | null
  canManageExternalStaff: boolean
  canViewPaymentSignals: boolean
}


const START_HOUR = 7
const END_HOUR = 22
const HOUR_HEIGHT = 100
const PX_PER_MIN = HOUR_HEIGHT / 60

const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => {
  const h = START_HOUR + i
  return { label: `${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`, hh: h.toString().padStart(2, '0') }
})

function timeToY(time: string): number {
  const [hStr, mStr] = time.split(':')
  return ((parseInt(hStr) - START_HOUR) * 60 + parseInt(mStr)) * PX_PER_MIN
}

type ApptLayoutInfo = { column: number; totalColumns: number }

function computeColumns<T extends { id: string; time: string; duration_minutes: number }>(
  appts: T[]
): Map<string, ApptLayoutInfo> {
  if (appts.length === 0) return new Map()
  const parsed = appts.map((a) => {
    const [h, m] = a.time.split(':').map(Number)
    const start = h * 60 + m
    return { id: a.id, start, end: start + a.duration_minutes }
  })
  parsed.sort((a, b) => a.start - b.start)
  const columnEnds: number[] = []
  const assigned = new Map<string, number>()
  for (const p of parsed) {
    let col = columnEnds.findIndex((end) => end <= p.start)
    if (col === -1) col = columnEnds.length
    columnEnds[col] = p.end
    assigned.set(p.id, col)
  }
  const result = new Map<string, ApptLayoutInfo>()
  for (const p of parsed) {
    const overlapping = parsed.filter((o) => o.start < p.end && o.end > p.start)
    const maxCol = Math.max(...overlapping.map((o) => assigned.get(o.id)!))
    result.set(p.id, { column: assigned.get(p.id)!, totalColumns: maxCol + 1 })
  }
  return result
}

export function ScheduleView({
  initialAppointments,
  patients,
  assigneeOptions,
  externalStaffOptions,
  currentProfileId,
  canManageExternalStaff,
  canViewPaymentSignals,
}: ScheduleViewProps) {
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [calView, setCalView] = useState<'day' | 'week'>('day')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [mobileDialogOpen, setMobileDialogOpen] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [mobileCalendarOpen, setMobileCalendarOpen] = useState(false)
  const [filterType, setFilterType] = useState<'all' | AppointmentType>('all')
  const router = useRouter()

  useEffect(() => { setFilterType('all') }, [selectedDate])

  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 })
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const dayAppts = initialAppointments
    .filter((a) => isSameDay(parseISO(a.date), selectedDate))
    .sort((a, b) => a.time.localeCompare(b.time))

  const weekAppts = initialAppointments.filter((a) => {
    const d = parseISO(a.date)
    return d >= weekStart && d < addDays(weekStart, 7)
  })

  const filteredDayAppts = filterType === 'all'
    ? dayAppts
    : dayAppts.filter((a) => a.type === filterType)

  const dayColInfo = computeColumns(filteredDayAppts)

  const chipStyle = (a: typeof initialAppointments[0]): React.CSSProperties => ({
    borderLeftColor:
      a.status === 'completed' ? 'var(--ph-ok)' :
      a.status === 'cancelled' ? 'var(--ph-ink-4)' :
      TYPE_BORDER_COLOR[a.type],
    opacity: a.status === 'cancelled' ? 0.45 : a.status === 'completed' ? 0.75 : 1,
  })

  return (
    <>
      {/* Desktop topbar */}
      <div className="hidden md:flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ph-ink)' }}>
            Schedule
          </h1>
          <div className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)', marginTop: 2 }}>
            {format(selectedDate, 'MMM yyyy')}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="ph-toggle-group">
            <button className={`ph-toggle-opt ${calView === 'day' ? 'active' : ''}`} onClick={() => setCalView('day')}>Day</button>
            <button className={`ph-toggle-opt ${calView === 'week' ? 'active' : ''}`} onClick={() => setCalView('week')}>Week</button>
          </div>
          <button
            onClick={() => setSelectedDate((d) => addDays(d, calView === 'day' ? -1 : -7))}
            style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 6, border: '1px solid var(--ph-line)', background: 'var(--ph-surface)', cursor: 'pointer' }}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => setSelectedDate(new Date())}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--ph-line)', background: 'var(--ph-surface)', cursor: 'pointer', color: 'var(--ph-ink-2)' }}
          >
            Today
          </button>
          <button
            onClick={() => setSelectedDate((d) => addDays(d, calView === 'day' ? 1 : 7))}
            style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 6, border: '1px solid var(--ph-line)', background: 'var(--ph-surface)', cursor: 'pointer' }}
          >
            <ChevronRight size={14} />
          </button>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <button
                style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 6, border: '1px solid var(--ph-line)', background: 'var(--ph-surface)', cursor: 'pointer' }}
              >
                <CalendarIcon size={14} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  if (date) { setSelectedDate(date); setCalendarOpen(false) }
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <div style={{ width: 1, height: 20, background: 'var(--ph-line)' }} />
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <button style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 12.5, fontWeight: 500, padding: '7px 12px',
                borderRadius: 6, border: '1px solid var(--ph-accent)',
                background: 'var(--ph-accent)', color: '#fff', cursor: 'pointer',
              }}>
                <Plus size={14} />New appointment
              </button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader><DialogTitle>New Appointment</DialogTitle></DialogHeader>
              <AppointmentForm
                patients={patients}
                assigneeOptions={assigneeOptions}
                externalStaffOptions={externalStaffOptions}
                currentProfileId={currentProfileId}
                canManageExternalStaff={canManageExternalStaff}
                defaultDate={format(selectedDate, 'yyyy-MM-dd')}
                onSuccess={() => { setDialogOpen(false); router.refresh() }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Mobile topbar */}
      <div className="flex md:hidden items-center justify-between mb-4">
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em' }}>Schedule</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          <Dialog open={mobileDialogOpen} onOpenChange={setMobileDialogOpen}>
            <DialogTrigger asChild>
              <button className="min-w-[44px] min-h-[44px]" style={{
                display: 'grid', placeItems: 'center',
                borderRadius: 8, border: '1px solid var(--ph-accent)',
                background: 'var(--ph-accent)', color: '#fff', cursor: 'pointer',
              }}>
                <Plus size={15} />
              </button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader><DialogTitle>New Appointment</DialogTitle></DialogHeader>
              <AppointmentForm
                patients={patients}
                assigneeOptions={assigneeOptions}
                externalStaffOptions={externalStaffOptions}
                currentProfileId={currentProfileId}
                canManageExternalStaff={canManageExternalStaff}
                defaultDate={format(selectedDate, 'yyyy-MM-dd')}
                onSuccess={() => { setMobileDialogOpen(false); router.refresh() }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Mobile calendar jump */}
      <div className="flex justify-end mb-2 md:hidden">
        <Popover open={mobileCalendarOpen} onOpenChange={setMobileCalendarOpen}>
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
                if (date) { setSelectedDate(date); setMobileCalendarOpen(false) }
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Date strip (always visible) */}
      <div className="ph-date-strip mb-4">
        {weekDays.map((day, i) => {
          const isToday = isSameDay(day, new Date())
          const isSel = isSameDay(day, selectedDate)
          const count = initialAppointments.filter((a) => isSameDay(parseISO(a.date), day)).length
          return (
            <button
              key={i}
              onClick={() => { setSelectedDate(day); setCalView('day') }}
              style={{
                minWidth: 48, padding: '8px 4px', textAlign: 'center',
                border: `1px solid ${isSel ? 'var(--ph-accent)' : 'var(--ph-line)'}`,
                background: isSel ? 'var(--ph-accent-soft)' : 'var(--ph-surface)',
                borderRadius: 8, cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <div style={{ fontSize: 9.5, color: isSel ? 'var(--ph-accent-ink)' : 'var(--ph-ink-4)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {format(day, 'EEE')}
              </div>
              <div className="font-mono-data" style={{
                fontSize: 15, fontWeight: 500, marginTop: 2,
                color: isToday ? 'var(--ph-accent)' : isSel ? 'var(--ph-accent-ink)' : 'var(--ph-ink)',
              }}>
                {format(day, 'd').padStart(2, '0')}
              </div>
              <div style={{ fontSize: 9, color: isSel ? 'var(--ph-accent-ink)' : 'var(--ph-ink-4)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                {count > 0 ? `·${count}·` : '· ·'}
              </div>
            </button>
          )
        })}
      </div>

      {/* Mobile filter chips */}
      {calView === 'day' && (
        <div className="flex gap-2 mb-3 md:hidden">
          {(['all', 'clinic', 'home_visit', 'clinic_home_visit'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilterType(f)}
              aria-pressed={filterType === f}
              style={{
                padding: '5px 12px', fontSize: 12, borderRadius: 20,
                border: `1px solid ${filterType === f ? 'var(--ph-accent)' : 'var(--ph-line)'}`,
                background: filterType === f ? 'var(--ph-accent-soft)' : 'var(--ph-surface)',
                color: filterType === f ? 'var(--ph-accent-ink)' : 'var(--ph-ink-3)',
                cursor: 'pointer', fontWeight: filterType === f ? 600 : 400,
              }}
            >
              {f === 'all' ? 'All' : APPOINTMENT_TYPE_SHORT_LABEL[f]}
            </button>
          ))}
        </div>
      )}

      {/* Day view */}
      {calView === 'day' && (
        <div className="flex flex-col gap-4 md:grid" style={{ gridTemplateColumns: '1fr 280px' }}>

          {/* Timeline */}
          <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px 12px', borderBottom: '1px solid var(--ph-line)', display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--ph-ink)' }}>
                {format(selectedDate, 'EEEE')}
              </div>
              <div className="font-mono-data" style={{ fontSize: 12, color: 'var(--ph-ink-3)' }}>
                {format(selectedDate, 'MMM d, yyyy')}
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 11, color: 'var(--ph-ink-4)' }}>
                {filteredDayAppts.length} appointments
              </div>
            </div>

            {filteredDayAppts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
                {filterType === 'all'
                  ? 'No appointments on this day.'
                  : `No ${APPOINTMENT_TYPE_LABEL[filterType].toLowerCase()} appointments on this day.`}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr' }}>
                {/* Time labels */}
                <div style={{ position: 'relative', height: (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT }}>
                  {HOURS.map((h, i) => (
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
                <div style={{ position: 'relative', height: (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT, borderLeft: '1px solid var(--ph-line)' }}>
                  {HOURS.map((_h, i) => (
                    <div key={i} style={{
                      position: 'absolute',
                      top: i * HOUR_HEIGHT,
                      left: 0, right: 0,
                      borderTop: '1px solid var(--ph-line)',
                      pointerEvents: 'none',
                    }} />
                  ))}
                  {filteredDayAppts.map((a) => {
                    const info = dayColInfo.get(a.id) ?? { column: 0, totalColumns: 1 }
                    const top = timeToY(a.time.slice(0, 5))
                    const height = Math.max(a.duration_minutes * PX_PER_MIN, 24)
                    const widthPct = 100 / info.totalColumns
                    const leftPct = info.column * widthPct
                    // Three size tiers so text never clips:
                    //  - compact  (< 40px): single row, time + name inline (tiny slots)
                    //  - medium   (40–61px): two lines, time + name, no meta (e.g. 30-min = 50px)
                    //  - tall     (>= 62px): three lines incl. duration · type · assignee
                    const compact = height < 40
                    const showMeta = height >= 62
                    return (
                      <Link
                        key={a.id}
                        href={`/schedule/${a.id}`}
                        className="ph-appt-chip"
                        style={{
                          ...chipStyle(a),
                          position: 'absolute',
                          top: top + 1,
                          height: height - 2,
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
                        }}
                      >
                        <span className="font-mono-data" style={{ fontSize: 10, lineHeight: 1.2, color: 'var(--ph-ink-3)', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: compact ? undefined : '100%' }}>
                          {formatTime12(a.time)}
                        </span>
                        <span style={{ fontSize: compact ? 11 : 12.5, lineHeight: 1.2, fontWeight: 500, color: 'var(--ph-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', minWidth: 0 }}>
                          {a.patient?.name ?? 'Unknown'}
                        </span>
                        {showMeta && (() => {
                          const internalAssigneeName = isHomeVisitType(a.type) && canViewPaymentSignals && a.assigned_to
                            ? (assigneeOptions.find((o) => o.id === a.assigned_to)?.full_name ?? null)
                            : null
                          const externalAssigneeName = isHomeVisitType(a.type) && canViewPaymentSignals
                            ? (a.external_staff?.name ?? null)
                            : null
                          const assigneeName = externalAssigneeName ?? internalAssigneeName
                          return (
                            <span style={{ fontSize: 10.5, lineHeight: 1.2, color: 'var(--ph-ink-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
                              {a.duration_minutes}m · {APPOINTMENT_TYPE_SHORT_LABEL[a.type]}
                              {assigneeName && ` · ${assigneeName}`}
                            </span>
                          )
                        })()}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Side panel — desktop only */}
          <div className="hidden md:flex flex-col gap-4">
            <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, padding: '14px 16px' }}>
              <div className="ph-section-h" style={{ marginBottom: 10 }}><h2>Filters</h2></div>
              {[
                { label: 'All sessions',    n: dayAppts.length,                                            dot: 'var(--ph-ink-3)' },
                { label: 'Clinic',          n: dayAppts.filter((a) => a.type === 'clinic').length,          dot: 'var(--ph-accent)' },
                { label: 'Home visits',     n: dayAppts.filter((a) => a.type === 'home_visit').length,      dot: 'var(--ph-warn)' },
                { label: 'Clinic home',     n: dayAppts.filter((a) => a.type === 'clinic_home_visit').length, dot: 'var(--ph-info)' },
                { label: 'Completed',       n: dayAppts.filter((a) => a.status === 'completed').length,     dot: 'var(--ph-ok)' },
              ].map((f) => (
                <div key={f.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', borderRadius: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: f.dot, flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, color: 'var(--ph-ink-2)' }}>{f.label}</span>
                  </div>
                  <span className="font-mono-data" style={{ fontSize: 11.5, color: 'var(--ph-ink-4)' }}>{f.n}</span>
                </div>
              ))}
            </div>

            {canViewPaymentSignals && (
              <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, padding: '14px 16px' }}>
                <div className="ph-section-h" style={{ marginBottom: 10 }}><h2>Day total</h2></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--ph-ink-3)' }}>Expected</span>
                    <span className="ph-money">
                      <span className="rs">₹</span>
                      {dayAppts
                        .filter((a) => a.status !== 'cancelled' && a.fee != null)
                        .reduce((s, a) => s + (a.fee ?? 0), 0)
                        .toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Week view */}
      {calView === 'week' && (
        <>
        <p className="md:hidden text-xs mb-2" style={{ color: 'var(--ph-ink-4)' }}>
          Scroll horizontally to see the full week
        </p>
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
            {weekDays.map((day, i) => (
              <div
                key={i}
                style={{
                  padding: '10px 6px', borderBottom: '1px solid var(--ph-line)',
                  fontSize: 11, textAlign: 'center',
                  color: isSameDay(day, new Date()) ? 'var(--ph-accent)' : 'var(--ph-ink-3)',
                  fontWeight: isSameDay(day, new Date()) ? 600 : 400,
                  borderLeft: '1px solid var(--ph-line)',
                }}
              >
                <div style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{format(day, 'EEE')}</div>
                <div className="font-mono-data" style={{ fontSize: 15, fontWeight: 500, marginTop: 2, color: isSameDay(day, new Date()) ? 'var(--ph-accent)' : 'var(--ph-ink)' }}>
                  {format(day, 'd')}
                </div>
              </div>
            ))}
            {HOURS.map((h) => (
              <>
                <div key={`t-${h.label}`} style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ph-ink-4)',
                  padding: '6px 6px', textAlign: 'right',
                  borderBottom: '1px solid var(--ph-line)',
                }}>
                  {h.label}
                </div>
                {weekDays.map((day, di) => {
                  const slotAppts = weekAppts.filter(
                    (a) => isSameDay(parseISO(a.date), day) && a.time.startsWith(h.hh)
                  )
                  return (
                    <div key={`${h.label}-${di}`} style={{
                      borderLeft: '1px solid var(--ph-line)', borderBottom: '1px solid var(--ph-line)',
                      minHeight: 44, padding: 4, fontSize: 10.5,
                    }}>
                      {slotAppts.map((a) => (
                        <Link key={a.id} href={`/schedule/${a.id}`} style={{
                          display: 'block',
                          background: TYPE_BG_COLOR[a.type],
                          color: TYPE_FG_COLOR[a.type],
                          borderRadius: 3, padding: '2px 4px', marginBottom: 2,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          textDecoration: 'none', fontSize: 10,
                        }}>
                          {formatTime12(a.time)} {a.patient?.name?.split(' ')[0] ?? '?'}
                        </Link>
                      ))}
                    </div>
                  )
                })}
              </>
            ))}
          </div>
        </div>
        </>
      )}
    </>
  )
}
