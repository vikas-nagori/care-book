'use client'

import { useMemo, useState, type MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { Plus, UserRound } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import {
  CalendarToolbar,
  DayHeader,
  DayTimeline,
  DesktopDateStrip,
  JumpToDate,
  MobileDateRail,
  TimelineChipContent,
  WeekGrid,
  type CalendarView,
} from '@/components/schedule/calendar-parts'
import { typeColorTokens } from '@/lib/schedule/calendar-layout'
import { countScheduleAppointmentsOnDate } from '@/lib/schedule/appointment-counts'
import { toViewerSlot } from '@/lib/external/calendar'
import type { ExternalAppointment, ExternalWorkspace } from '@/lib/external/types'
import { EXTERNAL_ACCESS_MESSAGE } from '@/lib/external/workspace'
import { formatTime12 } from '@/lib/format-time'
import { ExternalAppointmentDialog } from './appointment-dialog'
import { ExternalBookingDialog } from './booking-dialog'
import { useRequestIds } from './use-request-ids'
import { useCalendarDate } from '@/components/schedule/use-calendar-date'

type Props = {
  workspace: ExternalWorkspace
  selectedDate: string
  todayDate: string
  railDates: string[]
  timeZone: string
}

/** An appointment placed at the viewer's local date and time. */
type LocalAppointment = ExternalAppointment & { local_date: string; local_time: string }

const accent = typeColorTokens(true)

function chipStyle(a: LocalAppointment) {
  return {
    borderLeftColor: a.status === 'completed' ? 'var(--ph-ok)' : a.status === 'cancelled' ? 'var(--ph-ink-4)' : accent.border,
    opacity: a.status === 'cancelled' ? 0.45 : a.status === 'completed' ? 0.75 : 1,
  }
}

const primaryButton = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: 12.5, fontWeight: 500, padding: '7px 12px',
  borderRadius: 6, border: '1px solid var(--ph-accent)',
  background: 'var(--ph-accent)', color: '#fff', cursor: 'pointer',
} as const

export function ExternalSchedule({ workspace, selectedDate: initialDate, todayDate, railDates, timeZone }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const requestIds = useRequestIds()
  const [view, setView] = useState<CalendarView>('day')
  const { selectedDate, select } = useCalendarDate({
    initialDate,
    loadedFrom: railDates[0],
    loadedTo: railDates[railDates.length - 1],
    hrefFor: (date) => `/external?date=${date}`,
  })
  const [booking, setBooking] = useState<HTMLButtonElement | null>(null)
  const [opened, setOpened] = useState<{ appointment: ExternalAppointment; trigger: HTMLElement } | null>(null)
  const [denied, setDenied] = useState<ExternalWorkspace | null>(null)
  // Rows the server returned from a save, shown until the refreshed workspace replaces this one.
  // Without them a dialog reopened before the refresh lands holds the old slot, and Cancel
  // (which restates the stored slot) is refused.
  const [saved, setSaved] = useState<{ workspace: ExternalWorkspace; rows: Map<string, ExternalAppointment> } | null>(null)
  const canBook = workspace.patients.length > 0 && workspace.appointment_types.length > 0 && denied !== workspace
  const currentAppointments = useMemo(() => {
    const rows = saved?.workspace === workspace ? saved.rows : null
    return rows ? workspace.appointments.map((a) => rows.get(a.id) ?? a) : workspace.appointments
  }, [saved, workspace])

  const selected = parseISO(selectedDate)
  const weekStart = startOfWeek(selected, { weekStartsOn: 1 })
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const weekKeys = weekDays.map((day) => format(day, 'yyyy-MM-dd'))

  const appointments = useMemo<LocalAppointment[]>(() => currentAppointments.map((appointment) => {
    const slot = toViewerSlot(appointment, timeZone)
    return { ...appointment, local_date: slot.date, local_time: slot.time }
  }), [currentAppointments, timeZone])
  // The shared grid lays out by `date`/`time`; give it the viewer-local values.
  const placed = appointments.map((a) => ({ ...a, date: a.local_date, time: a.local_time }))
  const dayItems = placed.filter((a) => a.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time))
  const weekItems = placed.filter((a) => weekKeys.includes(a.date))
  const countOn = (date: string) => countScheduleAppointmentsOnDate(placed, date)
  const original = (id: string) => currentAppointments.find((a) => a.id === id)!

  function go(date: string, nextView: CalendarView = view) {
    select(date, nextView)
  }

  function openAppointment(event: MouseEvent<HTMLElement>, id: string) {
    setOpened({ appointment: original(id), trigger: event.currentTarget })
  }

  function onDenied() {
    setBooking(null)
    setOpened(null)
    setDenied(workspace)
    router.refresh()
  }

  function afterChange(message: string, date: string) {
    setBooking(null)
    setOpened(null)
    toast({ title: message })
    if (date !== selectedDate) go(date)
    router.refresh()
  }

  function afterSave(message: string, date: string, appointment: ExternalAppointment) {
    setSaved((previous) => {
      const rows = new Map(previous?.workspace === workspace ? previous.rows : [])
      rows.set(appointment.id, appointment)
      return { workspace, rows }
    })
    afterChange(message, date)
  }

  const newButton = (
    <button type="button" style={{ ...primaryButton, opacity: canBook ? 1 : 0.5 }} disabled={!canBook}
      onClick={(event) => setBooking(event.currentTarget)}>
      <Plus size={14} />New appointment
    </button>
  )

  return (
    <>
      <CalendarToolbar
        title="Schedule"
        selectedDate={selected}
        view={view}
        onViewChange={setView}
        onPrevious={() => go(format(addDays(selected, view === 'day' ? -1 : -7), 'yyyy-MM-dd'))}
        onToday={() => go(todayDate)}
        onNext={() => go(format(addDays(selected, view === 'day' ? 1 : 7), 'yyyy-MM-dd'))}
        onPickDate={(date) => go(format(date, 'yyyy-MM-dd'))}
        actions={newButton}
      />

      {/* Mobile topbar */}
      <div className="flex md:hidden items-center justify-between mb-4">
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em' }}>Schedule</h1>
        <button type="button" className="min-w-[44px] min-h-[44px]" aria-label="New appointment" disabled={!canBook}
          onClick={(event) => setBooking(event.currentTarget)}
          style={{ display: 'grid', placeItems: 'center', borderRadius: 8, border: '1px solid var(--ph-accent)', background: 'var(--ph-accent)', color: '#fff', opacity: canBook ? 1 : 0.5 }}>
          <Plus size={15} />
        </button>
      </div>

      <JumpToDate selectedDate={selected} onPickDate={(date) => go(format(date, 'yyyy-MM-dd'))} />

      <p className="mb-3 text-xs" style={{ color: 'var(--ph-ink-4)' }}>Times shown in {timeZone.replaceAll('_', ' ')}.</p>

      {denied === workspace ? (
        <div role="status" className="rounded-lg border bg-card p-5 text-sm">{EXTERNAL_ACCESS_MESSAGE}</div>
      ) : workspace.patients.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card px-5 py-11 text-center">
          <UserRound className="mx-auto mb-3 size-6 text-primary" aria-hidden="true" />
          <p className="font-semibold">No patients have been shared</p>
          <p className="mt-1 text-sm text-muted-foreground">Ask your clinic admin to share the patients you work with.</p>
        </div>
      ) : (
        <>
          <DesktopDateStrip dates={weekKeys} selectedDate={selectedDate} todayDate={todayDate} countOn={countOn}
            onSelect={(date) => { go(date, 'day'); setView('day') }} />
          <MobileDateRail dates={railDates} selectedDate={selectedDate} todayDate={todayDate} countOn={countOn}
            onSelect={(date) => { go(date, 'day'); setView('day') }} />

          {view === 'day' ? (
            <div style={{ background: 'var(--ph-surface)', border: '1px solid var(--ph-line)', borderRadius: 10, overflow: 'hidden' }}>
              <DayHeader selectedDate={selected} count={dayItems.length} isToday={selectedDate === todayDate} />
              {dayItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ph-ink-4)', fontSize: 13 }}>
                  No appointments on this day.
                </div>
              ) : (
                <DayTimeline
                  items={dayItems}
                  renderChip={(a, layout) => (
                    <button type="button" className="ph-appt-chip" onClick={(event) => openAppointment(event, a.id)}
                      style={{ ...chipStyle(a), ...layout.style, textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
                      <TimelineChipContent
                        layout={layout}
                        timeLabel={formatTime12(a.time)}
                        title={a.patient_name}
                        meta={`${a.duration_minutes}m · ${a.type}${a.status === 'scheduled' ? '' : ` · ${a.status}`}`}
                      />
                    </button>
                  )}
                />
              )}
              {workspace.appointment_types.length === 0 && (
                <p className="border-t px-5 py-3 text-sm text-muted-foreground">Ask your clinic admin to set up an appointment type.</p>
              )}
            </div>
          ) : (
            <>
              <p className="md:hidden text-xs mb-2" style={{ color: 'var(--ph-ink-4)' }}>Scroll horizontally to see the full week</p>
              <WeekGrid
                weekDays={weekDays}
                todayDate={todayDate}
                items={weekItems}
                renderItem={(a) => (
                  <button type="button" onClick={(event) => openAppointment(event, a.id)} style={{
                    display: 'block', width: '100%', textAlign: 'left', border: 0, cursor: 'pointer',
                    background: accent.bg, color: accent.fg, opacity: a.status === 'cancelled' ? 0.45 : 1,
                    borderRadius: 3, padding: '2px 4px', marginBottom: 2,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 10,
                  }}>
                    {formatTime12(a.time)} {a.patient_name.split(' ')[0]}
                  </button>
                )}
              />
            </>
          )}
        </>
      )}

      {booking && canBook && (
        <ExternalBookingDialog
          defaultDate={selectedDate}
          minDate={todayDate}
          onBooked={(date) => afterChange('Appointment booked', date)}
          onClose={() => setBooking(null)}
          onDenied={onDenied}
          patients={workspace.patients}
          types={workspace.appointment_types}
          timeZone={timeZone}
          getRequestId={requestIds.getRequestId}
          clearRequestId={requestIds.clearRequestId}
          returnFocus={booking}
        />
      )}

      {opened && (
        <ExternalAppointmentDialog
          key={opened.appointment.id}
          appointment={opened.appointment}
          types={workspace.appointment_types}
          minDate={todayDate}
          timeZone={timeZone}
          returnFocus={opened.trigger}
          onClose={() => setOpened(null)}
          onSaved={afterSave}
          onDenied={onDenied}
        />
      )}
    </>
  )
}
