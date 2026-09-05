'use client'

import { useId, useRef, useState } from 'react'
import type { CalendarReminder } from '@/lib/supabase/types'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { createReminder, updateReminder } from './reminder-actions'

const fieldClass = 'w-full min-w-0 rounded-lg border border-[var(--ph-line)] bg-[var(--ph-surface)] p-3 text-base'
const labelClass = 'mb-1.5 block text-sm text-[var(--ph-ink-2)]'

type Props = {
  patients: { id: string; name: string }[]
  defaultDate: string
  reminder?: CalendarReminder
  onSuccess: () => void
}

export function ReminderForm({ patients, defaultDate, reminder, onSuccess }: Props) {
  const prefix = useId()
  const [mode, setMode] = useState(reminder?.patient_id ? 'patient' : 'name')
  const [patientId, setPatientId] = useState(reminder?.patient_id ?? '')
  const [title, setTitle] = useState(reminder?.title ?? '')
  const [name, setName] = useState(reminder?.contact_name ?? '')
  const [date, setDate] = useState(reminder?.date ?? defaultDate)
  const [time, setTime] = useState(reminder?.time?.slice(0, 5) ?? '')
  const [phone, setPhone] = useState(reminder?.phone ?? '')
  const [notes, setNotes] = useState(reminder?.notes ?? '')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const saving = useRef(false)
  const patientOptions = patients.map(patient => ({ value: patient.id, label: patient.name }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving.current) return
    if (!title.trim()) { setError('Enter what needs following up.'); return }
    if (mode === 'patient' && !patientId) { setError('Choose a patient, or switch to name only.'); return }
    saving.current = true
    setPending(true)
    setError('')
    try {
      const input = { title, date, time, patientId: mode === 'patient' ? patientId || null : null, contactName: mode === 'name' ? name : null, phone, notes }
      const result = reminder ? await updateReminder(reminder.id, input) : await createReminder(input)
      if (result.success) onSuccess()
      else setError(result.message)
    } catch {
      setError('Could not save the reminder. Please try again.')
    } finally {
      saving.current = false
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        <legend className="sr-only">Reminder details</legend>
        <div className="flex gap-1 rounded-lg bg-[var(--ph-bg-soft)] p-1">
          {(['name', 'patient'] as const).map(option => (
            <button key={option} type="button" aria-pressed={mode === option}
              className={`min-h-11 flex-1 rounded-md px-2 text-sm ${mode === option ? 'bg-[var(--ph-accent-soft)] text-[var(--ph-accent-ink)]' : 'text-[var(--ph-ink-3)]'}`}
              onClick={() => { setMode(option); if (option === 'name') setPatientId('') }}>
              {option === 'name' ? 'Name only' : 'Existing patient'}
            </button>
          ))}
        </div>
        {mode === 'name' ? (
          <div>
            <label className={labelClass} htmlFor={`${prefix}-name`}>Name <span className="text-[var(--ph-ink-3)]">· Optional</span></label>
            <input id={`${prefix}-name`} className={fieldClass} value={name} onChange={e => setName(e.target.value)} maxLength={200} placeholder="e.g. Riya" />
            <p className="mt-1.5 text-xs text-[var(--ph-ink-3)]">No patient record will be created.</p>
          </div>
        ) : (
          <div>
            <label className={labelClass} htmlFor={`${prefix}-patient`}>Patient</label>
            <SearchableSelect id={`${prefix}-patient`} options={patientOptions} value={patientId || null} onChange={setPatientId}
              placeholder="Search or choose a patient" searchPlaceholder="Search patients…" emptyText="No matching patients. You can use name only."
              triggerClassName={`${fieldClass} h-auto min-h-11 shadow-none`} />
          </div>
        )}
        <div>
          <label className={labelClass} htmlFor={`${prefix}-title`}>What needs following up?</label>
          <input id={`${prefix}-title`} className={fieldClass} required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Call about first appointment" />
        </div>
        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
          <div><label className={labelClass} htmlFor={`${prefix}-date`}>Date</label><input id={`${prefix}-date`} type="date" className={fieldClass} required value={date} onChange={e => setDate(e.target.value)} /></div>
          <div><label className={labelClass} htmlFor={`${prefix}-time`}>Time <span className="text-[var(--ph-ink-3)]">· Optional</span></label><input id={`${prefix}-time`} type="time" className={fieldClass} value={time} onChange={e => setTime(e.target.value)} /></div>
        </div>
        <details open={reminder?.phone || reminder?.notes ? true : undefined}>
          <summary className="min-h-11 cursor-pointer py-3 text-sm text-[var(--ph-accent)]">Add phone or notes</summary>
          <div className="space-y-3">
            <div><label className={labelClass} htmlFor={`${prefix}-phone`}>Phone · Optional</label><input id={`${prefix}-phone`} type="tel" className={fieldClass} value={phone} onChange={e => setPhone(e.target.value)} maxLength={50} /></div>
            <div><label className={labelClass} htmlFor={`${prefix}-notes`}>Notes · Optional</label><textarea id={`${prefix}-notes`} className={fieldClass} rows={3} maxLength={5000} value={notes} onChange={e => setNotes(e.target.value)} /></div>
          </div>
        </details>
      </fieldset>
      {error && <p role="alert" className="text-sm text-[var(--ph-bad)]">{error}</p>}
      <button disabled={pending} className="min-h-11 w-full rounded-lg bg-[var(--ph-accent)] px-4 py-3 text-sm text-white disabled:opacity-60" type="submit">{pending ? 'Saving…' : 'Save reminder'}</button>
    </form>
  )
}
