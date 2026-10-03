'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { format, parseISO } from 'date-fns'
import { BellRing } from 'lucide-react'
import type { CalendarReminder } from '@/lib/supabase/types'
import { formatTime12 } from '@/lib/format-time'
import { isReminderOverdue, selectDashboardReminders } from '@/lib/reminders/dashboard'
import { getDashboardReminderPatients } from './dashboard-actions'

const ReminderDialog = dynamic(() => import('./schedule/reminder-dialog').then(module => module.ReminderDialog))

type Props = {
  reminders: CalendarReminder[]
  /** Today's calendar date (yyyy-MM-dd) in the viewer's time zone. */
  today: string
  loadError?: boolean
}

/**
 * Pending reminders that belong on today's schedule. A reminder stays here — flagged as overdue
 * once its date has passed — until someone marks it complete or deletes it.
 */
export function DashboardReminders({ reminders, today, loadError = false }: Props) {
  const rows = selectDashboardReminders(reminders, today)
  const [selected, setSelected] = useState<CalendarReminder | undefined>()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [patients, setPatients] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [optionsError, setOptionsError] = useState(false)
  const mounted = useRef(true)
  const inFlight = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const triggerRef = useRef<HTMLElement | null>(null)

  async function openReminder(reminder: CalendarReminder) {
    if (inFlight.current) return
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inFlight.current = true
    setLoading(true)
    setOptionsError(false)
    try {
      const result = await getDashboardReminderPatients()
      if (!mounted.current) return
      if (!result.ok) { setOptionsError(true); return }
      setPatients(result.patients)
      setSelected(reminder)
      setOpen(true)
    } catch {
      if (mounted.current) setOptionsError(true)
    } finally {
      inFlight.current = false
      if (mounted.current) setLoading(false)
    }
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
            disabled={loading}
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
      {loading && <p role="status" className="px-4 py-2 text-sm">Loading reminder…</p>}
      {optionsError && <p role="alert" className="px-4 py-2 text-sm">Unable to load reminder options. Select the reminder to retry.</p>}
      {open && (
        <ReminderDialog open onOpenChange={setOpen} reminder={selected} patients={patients}
          defaultDate={today} onSuccess={setMessage} returnFocusRef={triggerRef} />
      )}
    </section>
  )
}
