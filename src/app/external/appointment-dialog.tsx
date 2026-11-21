'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getClinicBookingSlot, toViewerSlot } from '@/lib/external/calendar'
import type { ExternalAppointment, ExternalAppointmentType } from '@/lib/external/types'
import { formatTime12 } from '@/lib/format-time'
import { formatDateOnly } from '@/lib/timezone'
import { updateExternalAppointment } from './actions'

type Props = {
  appointment: ExternalAppointment
  types: ExternalAppointmentType[]
  /** Earliest bookable date in the viewer's zone; the server enforces the clinic date. */
  minDate: string
  timeZone: string
  returnFocus: HTMLElement
  onClose: () => void
  onSaved: (message: string, date: string) => void
  onDenied: () => void
}

const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const STATUS_LABEL: Record<ExternalAppointment['status'], string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export function ExternalAppointmentDialog({ appointment, types, minDate, timeZone, returnFocus, onClose, onSaved, onDenied }: Props) {
  const id = useId()
  const local = toViewerSlot(appointment, timeZone)
  const editable = appointment.status === 'scheduled' && local.date >= minDate
  const [typeId, setTypeId] = useState(appointment.appointment_type_id)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const submitting = useRef(false)

  async function send(request: Parameters<typeof updateExternalAppointment>[0], success: string, date: string) {
    if (submitting.current) return
    submitting.current = true
    setPending(true)
    setMessage('')
    try {
      const result = await updateExternalAppointment(request)
      if (result.success) onSaved(success, date)
      else if (result.accessDenied) onDenied()
      else setMessage(result.message)
    } catch {
      setMessage('Unable to confirm this change. Refresh to check whether it was saved.')
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  function reschedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const date = String(form.get('date') ?? '')
    const slot = getClinicBookingSlot(date, String(form.get('time') ?? ''), timeZone)
    if (!slot) {
      setMessage('Choose a valid date and time.')
      return
    }
    void send({
      id: appointment.id,
      appointment_type_id: String(form.get('type') ?? ''),
      date: slot.date,
      time: slot.time,
      duration_minutes: Number(form.get('duration')),
      status: 'scheduled',
    }, 'Appointment updated', date)
  }

  function cancelAppointment() {
    // A cancellation restates the stored appointment exactly; it changes nothing but the status.
    void send({
      id: appointment.id,
      appointment_type_id: appointment.appointment_type_id,
      date: appointment.date,
      time: appointment.time.slice(0, 5),
      duration_minutes: appointment.duration_minutes,
      status: 'cancelled',
    }, 'Appointment cancelled', local.date)
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting.current) onClose() }}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-lg"
        onCloseAutoFocus={(event) => {
          if (returnFocus.isConnected) {
            event.preventDefault()
            returnFocus.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{appointment.patient_name}</DialogTitle>
          <DialogDescription>
            {formatDateOnly(local.date, 'EEE, d MMM yyyy')} · {formatTime12(local.time)} · {appointment.type} · {appointment.duration_minutes} min · {STATUS_LABEL[appointment.status]}
          </DialogDescription>
        </DialogHeader>

        {!editable ? (
          <p className="text-sm text-muted-foreground">
            {appointment.status === 'scheduled'
              ? 'Past appointments can’t be changed. Contact your clinic admin if something is wrong.'
              : `This appointment is ${STATUS_LABEL[appointment.status].toLowerCase()} and can’t be changed.`}
          </p>
        ) : confirmingCancel ? (
          <div className="grid gap-4">
            <p className="text-sm">Cancel this appointment? The clinic will see it as cancelled.</p>
            {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setConfirmingCancel(false)}>Keep appointment</Button>
              <Button type="button" variant="destructive" className="min-h-11" disabled={pending} onClick={cancelAppointment}>
                {pending ? 'Cancelling…' : 'Cancel appointment'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={reschedule}>
            <fieldset disabled={pending} className="grid gap-4">
              <legend className="sr-only">Reschedule appointment</legend>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-type`}>Appointment type</Label>
                <select id={`${id}-type`} name="type" className={selectClass} value={typeId} onChange={(event) => setTypeId(event.target.value)} required>
                  {!types.some((type) => type.id === typeId) && <option value={typeId}>{appointment.type}</option>}
                  {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid min-w-0 gap-1.5">
                  <Label htmlFor={`${id}-date`}>Date</Label>
                  <Input id={`${id}-date`} name="date" type="date" min={minDate} max="9999-12-30" defaultValue={local.date} required />
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <Label htmlFor={`${id}-time`}>Time</Label>
                  <Input id={`${id}-time`} name="time" type="time" defaultValue={local.time} required />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-duration`}>Duration (minutes)</Label>
                <Input id={`${id}-duration`} name="duration" type="number" min={1} max={1440} step={1} defaultValue={appointment.duration_minutes} required />
              </div>
              {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
              <DialogFooter className="gap-2 sm:justify-between">
                <Button type="button" variant="ghost" className="min-h-11 text-destructive" onClick={() => { setMessage(''); setConfirmingCancel(true) }}>
                  Cancel appointment
                </Button>
                <Button type="submit" className="min-h-11">{pending ? 'Saving…' : 'Save changes'}</Button>
              </DialogFooter>
            </fieldset>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
