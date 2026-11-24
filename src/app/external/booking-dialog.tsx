'use client'

import { callServerAction } from '@/lib/actions/call-server-action'
import { useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getClinicBookingSlot } from '@/lib/external/calendar'
import type { ExternalAppointmentType } from '@/lib/external/types'
import { createExternalAppointment } from './actions'

type Props = {
  defaultPatientId?: string
  defaultDate: string
  /** Earliest bookable date (today in the viewer's zone); the server enforces the clinic date. */
  minDate: string
  timeZone: string
  patients: { id: string; name: string }[]
  types: ExternalAppointmentType[]
  getRequestId: (intent: string) => string
  clearRequestId: (intent: string) => void
  returnFocus: HTMLButtonElement
  onClose: () => void
  onBooked: (date: string) => void
  onDenied: () => void
}

const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function ExternalBookingDialog({
  defaultPatientId,
  defaultDate,
  minDate,
  timeZone,
  patients,
  types,
  getRequestId,
  clearRequestId,
  returnFocus,
  onClose,
  onBooked,
  onDenied,
}: Props) {
  const id = useId()
  const [patientId, setPatientId] = useState(defaultPatientId ?? (patients.length === 1 ? patients[0].id : ''))
  const [typeId, setTypeId] = useState(types.length === 1 ? types[0].id : '')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const submitting = useRef(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const form = new FormData(event.currentTarget)
    const date = String(form.get('date') ?? '')
    const time = String(form.get('time') ?? '')
    const slot = getClinicBookingSlot(date, time, timeZone)
    if (!slot) {
      setMessage('Choose a valid date and time.')
      return
    }
    const duration = Number(form.get('duration'))
    const patient = String(form.get('patient') ?? '')
    const type = String(form.get('type') ?? '')
    const intent = JSON.stringify([patient, type, slot.date, slot.time, duration])

    submitting.current = true
    setPending(true)
    setMessage('')
    try {
      const result = await callServerAction(() => createExternalAppointment({
        id: getRequestId(intent),
        patient_id: patient,
        appointment_type_id: type,
        date: slot.date,
        time: slot.time,
        duration_minutes: duration,
      }), { failureMessage: 'Unable to confirm this booking. Try again to check if it was saved.' })
      if (result.success) {
        clearRequestId(intent)
        onBooked(date)
      } else if ('accessDenied' in result && result.accessDenied) {
        onDenied()
      } else {
        setMessage(result.message)
      }
    } catch {
      setMessage('Unable to confirm this booking. Try again to check if it was saved.')
    } finally {
      submitting.current = false
      setPending(false)
    }
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
          <DialogTitle>New appointment</DialogTitle>
          <DialogDescription>Enter the date and time in {timeZone.replaceAll('_', ' ')}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <fieldset disabled={pending} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-patient`}>Patient</Label>
              <select
                id={`${id}-patient`}
                name="patient"
                className={selectClass}
                value={patients.some((patient) => patient.id === patientId) ? patientId : ''}
                onChange={(event) => setPatientId(event.target.value)}
                required
              >
                <option value="" disabled>Choose a shared patient</option>
                {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-type`}>Appointment type</Label>
              <select
                id={`${id}-type`}
                name="type"
                className={selectClass}
                value={types.some((type) => type.id === typeId) ? typeId : ''}
                onChange={(event) => setTypeId(event.target.value)}
                required
              >
                <option value="" disabled>Choose an appointment type</option>
                {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor={`${id}-date`}>Date</Label>
                <Input id={`${id}-date`} name="date" type="date" min={minDate} max="9999-12-30" defaultValue={defaultDate < minDate ? minDate : defaultDate} required />
              </div>
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor={`${id}-time`}>Time</Label>
                <Input id={`${id}-time`} name="time" type="time" required />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-duration`}>Duration (minutes)</Label>
              <Input id={`${id}-duration`} name="duration" type="number" min={1} max={1440} step={1} defaultValue={30} required />
            </div>
            {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>Cancel</Button>
              <Button type="submit" className="min-h-11">{pending ? 'Booking…' : 'Book appointment'}</Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  )
}
