'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { format, addDays, startOfWeek, isSameDay, parseISO } from 'date-fns'
import { Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { AppointmentForm } from './appointment-form'
import { ReminderList } from './reminder-list'
import { ReminderDialog } from './reminder-dialog'
import type { Appointment, AppointmentAssigneeOption, Doctor, ExternalStaff, CalendarReminder } from '@/lib/supabase/types'
import Link from 'next/link'
import type { ExternalProfileOption } from '@/lib/appointments/assignment'
import { formatTime12 } from '@/lib/format-time'
import { buildScheduleRailDates, getScheduleDateNavigation } from '@/lib/schedule/date-range'
import { typeColorTokens } from '@/lib/schedule/calendar-layout'
import {
  CalendarToolbar,
  DayHeader,
  DayTimeline,
  DesktopDateStrip,
  JumpToDate,
  MobileDateRail,
  TimelineChipContent,
  WeekGrid,
} from '@/components/schedule/calendar-parts'
import { useCalendarDate } from '@/components/schedule/use-calendar-date'
import { countScheduleAppointmentsOnDate } from '@/lib/schedule/appointment-counts'

interface ScheduleViewProps {
  initialReminders?: CalendarReminder[]
  remindersLoadError?: boolean
  initialSelectedDate: string
  todayDate: string
  initialAppointments: (Pick<Appointment, 'id' | 'date' | 'time' | 'duration_minutes' | 'type' | 'type_is_shared' | 'status'> & {
    payment_status?: Appointment['payment_status']
    assigned_to?: string | null
    external_staff_id?: string | null
    external_profile_id?: string | null
    external_profile?: ExternalProfileOption | null
    fee?: number | null
    patient: { id: string; name: string; phone: string } | null
    external_staff?: Pick<ExternalStaff, 'id' | 'name' | 'phone' | 'status' | 'linked_profile_id'> | null
  })[]
  patients: { id: string; name: string }[]
  doctors: Doctor[]
  assigneeOptions: AppointmentAssigneeOption[]
  externalStaffOptions: ExternalStaff[]
  currentProfileId: string | null
  canManageExternalStaff: boolean
  canViewPaymentSignals: boolean
}


export function ScheduleView({
  initialReminders = [],
  remindersLoadError = false,
  initialSelectedDate,
  todayDate,
  initialAppointments,
  patients,
  doctors,
  assigneeOptions,
  externalStaffOptions,
  currentProfileId,
  canManageExternalStaff,
  canViewPaymentSignals,
}: ScheduleViewProps) {
  function externalAssigneeLabel(appointment: ScheduleViewProps['initialAppointments'][number]) {
    if (!canManageExternalStaff || !appointment.external_profile_id) return null
    const name = appointment.external_profile?.full_name || appointment.external_profile?.email
    return name ? `${name} · External Staff` : 'External Staff'
  }

  // The loaded window is centred on the server-rendered date; taps inside it stay on the device.
  const mobileRailDates = useMemo(
    () => buildScheduleRailDates(initialSelectedDate),
    [initialSelectedDate]
  )
  const { selectedDate: selectedKey, select } = useCalendarDate({
    initialDate: initialSelectedDate,
    loadedFrom: mobileRailDates[0],
    loadedTo: mobileRailDates[mobileRailDates.length - 1],
    hrefFor: (date) => getScheduleDateNavigation(date).href,
  })
  const selectedDate = useMemo(() => parseISO(selectedKey), [selectedKey])
  const [calView, setCalView] = useState<'day' | 'week'>('day')
  const [reminderOpen, setReminderOpen] = useState(false)
  const [selectedReminder, setSelectedReminder] = useState<CalendarReminder | undefined>()
  const [reminderMessage, setReminderMessage] = useState('')
  const reminderTriggerRef = useRef<HTMLElement | null>(null)
  function openReminder(reminder?: CalendarReminder) {
    reminderTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelectedReminder(reminder)
    setReminderOpen(true)
  }
  const [dialogOpen, setDialogOpen] = useState(false)
  const [mobileDialogOpen, setMobileDialogOpen] = useState(false)
  const [filterType, setFilterType] = useState<'all' | string>('all')
  const router = useRouter()

  useEffect(() => { setFilterType('all') }, [selectedKey])

  const navigateToDateString = (date: string, view: 'day' | 'week' = calView) => select(date, view)

  const navigateToDate = (date: Date) => {
    navigateToDateString(format(date, 'yyyy-MM-dd'))
  }

  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 })
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const dayAppts = initialAppointments
    .filter((a) => isSameDay(parseISO(a.date), selectedDate))
    .sort((a, b) => a.time.localeCompare(b.time))

  const weekAppts = initialAppointments.filter((a) => {
    const d = parseISO(a.date)
    return d >= weekStart && d < addDays(weekStart, 7)
  })

  const dayTypeNames = Array.from(new Set(dayAppts.map((a) => a.type)))
  const filteredDayAppts = filterType === 'all'
    ? dayAppts
    : dayAppts.filter((a) => a.type === filterType)

  const countOn = (date: string) => countScheduleAppointmentsOnDate(initialAppointments, date)

  const chipStyle = (a: typeof initialAppointments[0]): React.CSSProperties => ({
    borderLeftColor:
      a.status === 'completed' ? 'var(--ph-ok)' :
      a.status === 'cancelled' ? 'var(--ph-ink-4)' :
      typeColorTokens(a.type_is_shared).border,
    opacity: a.status === 'cancelled' ? 0.45 : a.status === 'completed' ? 0.75 : 1,
  })

  return (
    <>
      {/* Desktop topbar */}
      <CalendarToolbar
        title="Schedule"
        selectedDate={selectedDate}
        view={calView}
        onViewChange={setCalView}
        onPrevious={() => navigateToDate(addDays(selectedDate, calView === 'day' ? -1 : -7))}
        onToday={() => navigateToDateString(todayDate)}
        onNext={() => navigateToDate(addDays(selectedDate, calView === 'day' ? 1 : 7))}
        onPickDate={navigateToDate}
        actions={<>
          <button type="button" aria-label="Add reminder" onClick={() => openReminder()}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-[var(--ph-accent)] bg-[var(--ph-surface)] px-3 text-xs text-[var(--ph-accent)]">
            <Plus size={14} aria-hidden="true" />Reminder
          </button>
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
                doctors={doctors}
                assigneeOptions={assigneeOptions}
                externalStaffOptions={externalStaffOptions}
                currentProfileId={currentProfileId}
                canManageExternalStaff={canManageExternalStaff}
                canViewPaymentSignals={canViewPaymentSignals}
                defaultDate={format(selectedDate, 'yyyy-MM-dd')}
                onSuccess={() => { setDialogOpen(false); router.refresh() }}
              />
            </DialogContent>
          </Dialog>
        </>}
      />

      {/* Mobile topbar */}
      <div className="flex md:hidden items-center justify-between mb-4">
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em' }}>Schedule</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" aria-label="Add reminder" onClick={() => openReminder()}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-[var(--ph-accent)] bg-[var(--ph-surface)] px-3 text-xs text-[var(--ph-accent)]">
            <Plus size={14} aria-hidden="true" />Reminder
          </button>
          <Dialog open={mobileDialogOpen} onOpenChange={setMobileDialogOpen}>
            <DialogTrigger asChild>
              <button className="min-w-[44px] min-h-[44px]" style={{
                display: 'grid', placeItems: 'center',
                borderRadius: 8, border: '1px solid var(--ph-accent)',
                background: 'var(--ph-accent)', color: '#fff', cursor: 'pointer',
              }} aria-label="New Appointment">
                <Plus size={15} />
              </button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader><DialogTitle>New Appointment</DialogTitle></DialogHeader>
              <AppointmentForm
                patients={patients}
                doctors={doctors}
                assigneeOptions={assigneeOptions}
                externalStaffOptions={externalStaffOptions}
                currentProfileId={currentProfileId}
                canManageExternalStaff={canManageExternalStaff}
                canViewPaymentSignals={canViewPaymentSignals}
                defaultDate={format(selectedDate, 'yyyy-MM-dd')}
                onSuccess={() => { setMobileDialogOpen(false); router.refresh() }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Mobile calendar jump */}
      <JumpToDate selectedDate={selectedDate} onPickDate={navigateToDate} />

      <p role="status" className="text-sm text-[var(--ph-accent)]">{reminderMessage}</p>
      {reminderOpen && <ReminderDialog open onOpenChange={setReminderOpen} reminder={selectedReminder} patients={patients}
        defaultDate={selectedKey} onSuccess={setReminderMessage} returnFocusRef={reminderTriggerRef} />}

      {/* Desktop date strip */}
      <DesktopDateStrip
        dates={weekDays.map((day) => format(day, 'yyyy-MM-dd'))}
        selectedDate={selectedKey}
        todayDate={todayDate}
        countOn={countOn}
        onSelect={(date) => { navigateToDateString(date, 'day'); setCalView('day') }}
      />

      {/* Mobile rolling date rail */}
      <MobileDateRail
        dates={mobileRailDates}
        selectedDate={selectedKey}
        todayDate={todayDate}
        countOn={countOn}
        onSelect={(date) => { navigateToDateString(date, 'day'); setCalView('day') }}
      />

      {/* Mobile filter chips */}
      {calView === 'day' && (
        <div className="flex gap-2 mb-3 md:hidden">
          {['all', ...dayTypeNames].map((f) => (
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
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>
      )}

      {/* Day view */}
      {calView === 'day' && (
        <div className="flex flex-col gap-4 md:grid" style={{ gridTemplateColumns: '1fr 280px' }}>

          {/* Timeline */}
          <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}>
            <DayHeader selectedDate={selectedDate} count={filteredDayAppts.length} isToday={selectedKey === todayDate} />

            <ReminderList key={selectedKey} reminders={initialReminders.filter(reminder => reminder.date === selectedKey)}
              loadError={remindersLoadError} onSelect={openReminder} />

            {filteredDayAppts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
                {filterType === 'all'
                  ? 'No appointments on this day.'
                  : `No ${filterType.toLowerCase()} appointments on this day.`}
              </div>
            ) : (
              <DayTimeline
                items={filteredDayAppts}
                renderChip={(a, layout) => {
                  const externalAssignee = externalAssigneeLabel(a)
                  const internalAssignee = !a.type_is_shared && canViewPaymentSignals
                    ? assigneeOptions.find((option) => option.id === a.assigned_to)?.full_name
                    : null
                  const temporaryAssignee = !a.type_is_shared && canViewPaymentSignals ? a.external_staff?.name : null
                  const assignee = temporaryAssignee || internalAssignee
                  return (
                    <Link
                      href={`/schedule/${a.id}`}
                      className="ph-appt-chip"
                      title={externalAssignee ?? undefined}
                      style={{ ...chipStyle(a), ...layout.style }}
                    >
                      <TimelineChipContent
                        layout={layout}
                        timeLabel={formatTime12(a.time)}
                        title={a.patient?.name ?? 'Unknown'}
                        inlineSuffix={externalAssignee}
                        meta={externalAssignee
                          ? `${externalAssignee} · ${a.type} · ${a.duration_minutes}m`
                          : `${a.duration_minutes}m · ${a.type}${assignee ? ` · ${assignee}` : ''}`}
                      />
                    </Link>
                  )
                }}
              />
            )}
          </div>

          {/* Side panel — desktop only */}
          <div className="hidden md:flex flex-col gap-4">
            <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, padding: '14px 16px' }}>
              <div className="ph-section-h" style={{ marginBottom: 10 }}><h2>Filters</h2></div>
              {[
                { label: 'All sessions',    n: dayAppts.length,                                            dot: 'var(--ph-ink-3)' },
                ...dayTypeNames.map((name) => ({
                  label: name,
                  n: dayAppts.filter((a) => a.type === name).length,
                  dot: typeColorTokens(dayAppts.find((a) => a.type === name)?.type_is_shared ?? false).border,
                })),
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
        <div className="mb-3 grid gap-2 md:grid-cols-7">
          {weekDays.map(day => (
            <ReminderList key={format(day, 'yyyy-MM-dd')} reminders={initialReminders.filter(reminder => reminder.date === format(day, 'yyyy-MM-dd'))}
              loadError={remindersLoadError} onSelect={openReminder} />
          ))}
        </div>
        <WeekGrid
          weekDays={weekDays}
          todayDate={todayDate}
          items={weekAppts}
          renderItem={(a) => {
            const externalAssignee = externalAssigneeLabel(a)
            return (
              <Link href={`/schedule/${a.id}`} title={externalAssignee ?? undefined} style={{
                display: 'block',
                background: typeColorTokens(a.type_is_shared).bg,
                color: typeColorTokens(a.type_is_shared).fg,
                borderRadius: 3, padding: '2px 4px', marginBottom: 2,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                textDecoration: 'none', fontSize: 10,
              }}>
                {formatTime12(a.time)} {a.patient?.name?.split(' ')[0] ?? '?'}
                {externalAssignee && <span className="block truncate">{externalAssignee}</span>}
              </Link>
            )
          }}
        />
        </>
      )}
    </>
  )
}
