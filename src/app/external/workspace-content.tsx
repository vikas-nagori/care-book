'use client'

import { useRef, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Plus, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import type { ExternalAppointment, ExternalPatient, ExternalWorkspace } from '@/lib/external/types'
import { EXTERNAL_ACCESS_MESSAGE } from '@/lib/external/workspace'
import { formatTime12 } from '@/lib/format-time'
import { addCalendarDays, appointmentToInstant, formatDateOnly, getZonedTime, isInstantInInterval } from '@/lib/timezone'
import { ExternalBookingDialog } from './booking-dialog'
import type { WorkspaceTab } from './workspace-shell'

type Props = {
  workspace: ExternalWorkspace
  tab: Exclude<WorkspaceTab, 'account'>
  selectedDate: string
  today: string
  dayStart: string
  dayEnd: string
  timeZone: string
}

const appointmentStatus: Record<ExternalAppointment['status'], { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  scheduled: { label: 'Scheduled', variant: 'default' },
  completed: { label: 'Completed', variant: 'secondary' },
  cancelled: { label: 'Cancelled', variant: 'outline' },
}

function calendarLink(date: string) {
  return `/external?date=${date}`
}

function PatientDetails({ patient }: { patient: ExternalPatient }) {
  const details = [
    { label: 'Phone', value: patient.phone, href: patient.phone ? `tel:${patient.phone}` : null },
    { label: 'Email', value: patient.email, href: patient.email ? `mailto:${patient.email}` : null },
    { label: 'Date of birth', value: patient.dob ? formatDateOnly(patient.dob, 'd MMM yyyy') : null },
    { label: 'Gender', value: patient.gender },
    { label: 'Address', value: patient.address },
  ]

  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
      {details.map(({ label, value, href }) => (
        <div key={label} className={label === 'Address' ? 'col-span-2' : 'min-w-0'}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 break-words">
            {href ? <a href={href} className="text-primary underline-offset-2 hover:underline">{value}</a> : value ?? '—'}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function ExternalWorkspaceContent({ workspace, tab, selectedDate, today, dayStart, dayEnd, timeZone }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [booking, setBooking] = useState<{ patientId?: string; trigger: HTMLButtonElement } | null>(null)
  const [deniedWorkspace, setDeniedWorkspace] = useState<ExternalWorkspace | null>(null)
  const requestIds = useRef(new Map<string, string>())
  const canBook = workspace.patients.length > 0 && workspace.appointment_types.length > 0
  const appointments = tab === 'calendar'
    ? workspace.appointments
        .map((appointment) => ({ appointment, instant: appointmentToInstant(appointment.date, appointment.time) }))
        .filter(({ instant }) => isInstantInInterval(instant, new Date(dayStart), new Date(dayEnd)))
        .sort((left, right) => left.instant.getTime() - right.instant.getTime())
    : []

  function openBooking(event: MouseEvent<HTMLButtonElement>, patientId?: string) {
    setBooking({ patientId, trigger: event.currentTarget })
  }

  function getRequestId(intent: string) {
    const existingId = requestIds.current.get(intent)
    if (existingId) return existingId
    const requestId = crypto.randomUUID()
    requestIds.current.set(intent, requestId)
    return requestId
  }

  function afterBooking(date: string) {
    setBooking(null)
    toast({ title: 'Appointment booked' })
    if (date !== selectedDate || tab !== 'calendar') router.push(calendarLink(date))
    router.refresh()
  }

  function handleDeniedBooking() {
    setBooking(null)
    setDeniedWorkspace(workspace)
    router.refresh()
  }

  const title = tab === 'calendar' ? 'My Calendar' : 'Shared Patients'
  const noPatientAccess = workspace.patients.length === 0

  return (
    <section aria-labelledby="external-workspace-heading" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="external-workspace-heading" className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">{title}</h1>
        {tab === 'calendar' && (
          <Button type="button" className="min-h-11" disabled={!canBook || deniedWorkspace === workspace} onClick={openBooking}>
            <Plus aria-hidden="true" className="size-4" /> New appointment
          </Button>
        )}
      </div>

      {deniedWorkspace === workspace ? (
        <div role="status" className="rounded-lg border bg-card p-5 text-sm">{EXTERNAL_ACCESS_MESSAGE}</div>
      ) : noPatientAccess ? (
        <div className="rounded-lg border border-dashed bg-card px-5 py-11 text-center">
          <UserRound className="mx-auto mb-3 size-6 text-primary" aria-hidden="true" />
          <p className="font-semibold">No patients have been shared</p>
          <p className="mt-1 text-sm text-muted-foreground">Ask your clinic admin to share the patients you work with.</p>
        </div>
      ) : tab === 'calendar' ? (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
            <div>
              <h2 className="font-semibold">{formatDateOnly(selectedDate, 'EEEE, d MMMM yyyy')}</h2>
              <p className="text-xs text-muted-foreground">{timeZone.replaceAll('_', ' ')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button asChild variant="outline" size="icon" className="size-10">
                <Link href={calendarLink(addCalendarDays(selectedDate, -1))} prefetch={false} aria-label="Previous day"><ChevronLeft className="size-4" aria-hidden="true" /></Link>
              </Button>
              <Input
                aria-label="Calendar date"
                type="date"
                value={selectedDate}
                className="h-10 w-auto text-sm"
                onChange={(event) => { if (event.target.value) router.push(calendarLink(event.target.value)) }}
              />
              <Button asChild variant="outline" size="icon" className="size-10">
                <Link href={calendarLink(addCalendarDays(selectedDate, 1))} prefetch={false} aria-label="Next day"><ChevronRight className="size-4" aria-hidden="true" /></Link>
              </Button>
              {selectedDate !== today && (
                <Button asChild variant="ghost" className="h-10">
                  <Link href={calendarLink(today)} prefetch={false}>Today</Link>
                </Button>
              )}
            </div>
          </div>
          {appointments.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">No appointments on this day.</p>
          ) : (
            <ol className="divide-y">
              {appointments.map(({ appointment, instant }) => (
                <li key={appointment.id} className="grid grid-cols-[5.25rem_minmax(0,1fr)_auto] items-start gap-2 px-4 py-4 sm:gap-4 sm:px-5">
                  <time className="text-sm font-semibold tabular-nums text-primary" dateTime={instant.toISOString()}>
                    {formatTime12(getZonedTime(instant, timeZone))}
                  </time>
                  <div className="min-w-0 break-words">
                    <p className="text-sm font-semibold">{appointment.patient_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{appointment.type} · {appointment.duration_minutes} min</p>
                  </div>
                  <Badge variant={appointmentStatus[appointment.status].variant}>{appointmentStatus[appointment.status].label}</Badge>
                </li>
              ))}
            </ol>
          )}
          {!canBook && (
            <p className="border-t px-5 py-3 text-sm text-muted-foreground">Ask your clinic admin to set up an appointment type.</p>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {workspace.patients.map((patient) => (
            <article key={patient.id} className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:p-5">
              <h2 className="break-words text-lg font-semibold">{patient.name}</h2>
              <PatientDetails patient={patient} />
              <Button
                type="button"
                variant="outline"
                className="mt-auto min-h-11 w-full sm:w-fit"
                disabled={!canBook}
                onClick={(event) => openBooking(event, patient.id)}
              >
                <Plus aria-hidden="true" className="size-4" /> Book appointment
              </Button>
            </article>
          ))}
          {!canBook && <p className="text-sm text-muted-foreground sm:col-span-2">Ask your clinic admin to set up an appointment type.</p>}
        </div>
      )}

      {booking && deniedWorkspace !== workspace && canBook && (
        <ExternalBookingDialog
          defaultPatientId={booking.patientId}
          defaultDate={selectedDate}
          minDate={today}
          onBooked={afterBooking}
          onClose={() => setBooking(null)}
          onDenied={handleDeniedBooking}
          patients={workspace.patients}
          types={workspace.appointment_types}
          timeZone={timeZone}
          getRequestId={getRequestId}
          clearRequestId={(intent) => { requestIds.current.delete(intent) }}
          returnFocus={booking.trigger}
        />
      )}
    </section>
  )
}
