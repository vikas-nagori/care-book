'use client'

import { useId, useState } from 'react'
import { ChevronDown, ChevronUp, ListChecks } from 'lucide-react'
import type { CalendarReminder } from '@/lib/supabase/types'
import { sortReminders } from '@/lib/reminders/ordering'
import { formatTime12 } from '@/lib/format-time'

export function ReminderList({ reminders, loadError = false, onSelect }: {
  reminders: CalendarReminder[]
  loadError?: boolean
  onSelect: (reminder: CalendarReminder) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const listId = useId()
  return (
    <section aria-label="Day reminders" className="min-w-0 border-b border-[var(--ph-line)] bg-[var(--ph-bg)] px-3 pb-2">
      <button type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)}
        className="flex min-h-11 w-full items-center gap-1.5 py-2 text-left text-xs text-[var(--ph-accent)]">
        <ListChecks size={14} aria-hidden="true" /><span>Reminders{!loadError && ` · ${reminders.length}`}</span>
        {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {loadError && <p role="alert" className="text-xs text-[var(--ph-bad)]">Could not load reminders. Refresh to try again.</p>}
      <div id={listId} hidden={!expanded} className="space-y-1.5">
        {!loadError && !reminders.length && <p className="pb-1 text-xs text-[var(--ph-ink-3)]">No reminders for this day.</p>}
        {sortReminders(reminders).map(reminder => (
          <button key={reminder.id} type="button" onClick={() => onSelect(reminder)}
            className={`block min-h-11 w-full rounded-md px-3 py-2 text-left ${reminder.status === 'completed' ? 'bg-[var(--ph-ok-soft)]' : 'bg-[var(--ph-warn-soft)]'}`}>
            <span className="block break-words text-[11px] text-[var(--ph-ink-2)]">
              {reminder.status === 'completed' && 'Completed · '}
              {reminder.time ? formatTime12(reminder.time) : 'Any time'}
              {(reminder.patient?.name || reminder.contact_name) && ` · ${reminder.patient?.name || reminder.contact_name}`}
              {reminder.patient && ' · Patient'}
            </span>
            <span className="block break-words text-xs text-[var(--ph-ink)]">{reminder.title}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
