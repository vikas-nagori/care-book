'use client'

import { useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CalendarReminder } from '@/lib/supabase/types'
import { formatTime12 } from '@/lib/format-time'
import { ReminderForm } from './reminder-form'
import { deleteReminder, setReminderStatus } from './reminder-actions'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  reminder?: CalendarReminder
  patients: { id: string; name: string }[]
  defaultDate: string
  onSuccess?: (message: string) => void
  returnFocusRef?: React.RefObject<HTMLElement | null>
}

export function ReminderDialog({ open, onOpenChange, reminder, patients, defaultDate, onSuccess, returnFocusRef }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  function finish(message: string) {
    onOpenChange(false)
    onSuccess?.(message)
    router.refresh()
  }
  async function change(action: 'status' | 'delete') {
    if (!reminder || busy.current) return
    busy.current = true
    setPending(true)
    setError('')
    try {
      const result = action === 'delete'
        ? await deleteReminder(reminder.id)
        : await setReminderStatus(reminder.id, reminder.status === 'completed' ? 'pending' : 'completed')
      if (result.success) finish(action === 'delete' ? 'Reminder deleted.' : reminder.status === 'completed' ? 'Reminder reopened.' : 'Reminder completed.')
      else setError(result.message)
    } catch {
      setError('Could not save this change. Please try again.')
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={event => { if (returnFocusRef?.current?.isConnected) { event.preventDefault(); returnFocusRef.current.focus() } }} className="max-h-[90dvh] overflow-y-auto bg-[var(--ph-bg)] px-4 py-5 text-[var(--ph-ink)] sm:max-w-md sm:p-6 [&>button]:min-h-11 [&>button]:min-w-11" aria-describedby="reminder-description">
        <DialogHeader className="pr-10 text-left">
          <DialogTitle>{!reminder ? 'New reminder' : editing ? 'Edit reminder' : 'Reminder'}</DialogTitle>
          <DialogDescription id="reminder-description">{!reminder || editing ? 'Schedule a follow-up on your calendar.' : reminder.status === 'completed' ? 'Completed reminder' : 'Pending reminder'}</DialogDescription>
        </DialogHeader>
        {!reminder || editing ? (
          <ReminderForm patients={patients} defaultDate={defaultDate} reminder={reminder} onSuccess={() => finish('Reminder saved.')} />
        ) : (
          <div className="space-y-4">
            <h2 className="break-words text-lg font-medium">{reminder.title}</h2>
            <div className="space-y-3 rounded-lg border border-[var(--ph-line)] bg-[var(--ph-surface)] p-4 text-sm">
              <p className="break-words">{reminder.patient?.name || reminder.contact_name || 'No name added'}{reminder.patient && <span className="text-[var(--ph-ink-3)]"> · Existing patient</span>}</p>
              <p>{format(parseISO(reminder.date), 'd MMM yyyy')} · {reminder.time ? formatTime12(reminder.time) : 'Any time'}</p>
              {reminder.phone && <p className="break-words">Phone: {reminder.phone}</p>}
              {reminder.notes && <p className="whitespace-pre-wrap break-words text-[var(--ph-ink-2)]">{reminder.notes}</p>}
            </div>
            <button disabled={pending} onClick={() => change('status')} className="min-h-11 w-full rounded-lg bg-[var(--ph-accent)] px-4 py-3 text-sm text-white disabled:opacity-60">{pending ? 'Saving…' : reminder.status === 'completed' ? 'Reopen reminder' : 'Mark complete'}</button>
            <button disabled={pending} onClick={() => setEditing(true)} className="min-h-11 w-full rounded-lg border border-[var(--ph-line)] bg-[var(--ph-surface)] px-4 py-3 text-sm">Edit or reschedule</button>
            {!confirmDelete ? <button disabled={pending} onClick={() => setConfirmDelete(true)} className="min-h-11 w-full text-sm text-[var(--ph-bad)]">Delete reminder</button> : (
              <div className="rounded-lg border border-[var(--ph-line)] p-3">
                <p className="text-sm">Delete this reminder? This cannot be undone.</p>
                <div className="mt-3 flex gap-3">
                  <button disabled={pending} onClick={() => change('delete')} className="min-h-11 flex-1 rounded-lg bg-[var(--ph-bad)] px-3 text-sm text-white">Delete</button>
                  <button disabled={pending} onClick={() => setConfirmDelete(false)} className="min-h-11 flex-1 rounded-lg border border-[var(--ph-line)] px-3 text-sm">Keep reminder</button>
                </div>
              </div>
            )}
            {error && <p role="alert" className="text-sm text-[var(--ph-bad)]">{error}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
