'use client'

import { useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { BellRing } from 'lucide-react'
import type { CalendarReminder } from '@/lib/supabase/types'
import { formatTime12 } from '@/lib/format-time'
import { isReminderOverdue, selectDashboardReminders } from '@/lib/reminders/dashboard'
import { ReminderDialog } from './schedule/reminder-dialog'

type Props = {
  reminders: CalendarReminder[]
  patients: { id: string; name: string }[]
  /** Today's calendar date (yyyy-MM-dd) in the viewer's time zone. */
  today: string
  loadError?: boolean
}

/**
 * Pending reminders that belong on today's schedule. A reminder stays here — flagged as overdue
 * once its date has passed — until someone marks it complete or deletes it.
 */
export function DashboardReminders({ reminders, patients, today, loadError = false }: Props) {
  const rows = selectDashboardReminders(reminders, today)
  const [selected, setSelected] = useState<CalendarReminder | undefined>()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const triggerRef = useRef<HTMLElement | null>(null)

  function openReminder(reminder: CalendarReminder) {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelected(reminder)
    setOpen(true)
  }

  if (!rows.length && !loadError && !message) return null

  return (
    <section aria-label="Today's reminders" style={{ borderBottom: '1px solid var(--ph-line)' }}>
      {(rows.length > 0 || loadError) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px 6px', fontSize: 11.5, color: 'var(--ph-ink-3)' }}>
          <BellRing size={13} aria-hidden="true" />
          <span>Reminders{!loadError && ` · ${rows.length}`}</span>
        </div>
      )}
      {loadError && (
        <p role="alert" style={{ margin: 0, padding: '0 16px 10px', fontSize: 12, color: 'var(--ph-bad)' }}>
          Could not load reminders. Refresh to try again.
        </p>
      )}
      {rows.map(reminder => {
        const overdue = isReminderOverdue(reminder, today)
        const who = reminder.patient?.name || reminder.contact_name
        return (
          <button
            key={reminder.id}
            type="button"
            onClick={() => openReminder(reminder)}
            className="hover:bg-[var(--ph-bg-soft)]"
            style={{
              display: 'flex', alignItems: 'center', gap: 14, width: '100%', minHeight: 44,
              padding: '10px 16px', textAlign: 'left', color: 'inherit', background: 'var(--ph-warn-soft)',
              borderTop: '1px solid var(--ph-line)', borderLeft: `3px solid ${overdue ? 'var(--ph-bad)' : 'var(--ph-warn)'}`,
              borderRight: 'none', borderBottom: 'none', cursor: 'pointer',
            }}
          >
            <div style={{ minWidth: 48 }}>
              <div className="font-mono-data" style={{ fontSize: 13, fontWeight: 500, color: 'var(--ph-ink)' }}>
                {reminder.time ? formatTime12(reminder.time) : 'Any time'}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--ph-ink-4)', marginTop: 1 }}>Reminder</div>
            </div>
            <div style={{ width: 1, height: 28, background: 'var(--ph-line)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="break-words" style={{ fontSize: 13.5, fontWeight: 500 }}>{reminder.title}</div>
              {who && (
                <div className="break-words" style={{ fontSize: 11.5, color: 'var(--ph-ink-3)', marginTop: 1 }}>
                  {who}{reminder.patient && ' · Patient'}
                </div>
              )}
            </div>
            {overdue && (
              <span className="ph-badge bad" style={{ textTransform: 'none', fontSize: 10.5, flexShrink: 0 }}>
                <span className="ph-badge-dot" />
                Overdue · {format(parseISO(reminder.date), 'd MMM')}
              </span>
            )}
          </button>
        )
      })}
      {message && <p role="status" style={{ margin: 0, padding: '8px 16px', fontSize: 12, color: 'var(--ph-accent)' }}>{message}</p>}
      {open && (
        <ReminderDialog open onOpenChange={setOpen} reminder={selected} patients={patients}
          defaultDate={today} onSuccess={setMessage} returnFocusRef={triggerRef} />
      )}
    </section>
  )
}
