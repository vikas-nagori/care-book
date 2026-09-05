import type { Reminder } from '../supabase/types.ts'
import { sortReminders } from './ordering.ts'

type DashboardReminderRow = Pick<Reminder, 'id' | 'status' | 'time' | 'created_at' | 'date'>

/** A pending reminder dated before today has been carried forward, not forgotten. */
export function isReminderOverdue(reminder: Pick<Reminder, 'date'>, today: string): boolean {
  return reminder.date < today
}

/**
 * Reminders that belong on today's schedule: everything still pending whose date is today or
 * earlier. Completed reminders drop off immediately; overdue ones stay until they are closed.
 * Ordered oldest date first, then by the calendar's own time/creation order within a date.
 */
export function selectDashboardReminders<T extends DashboardReminderRow>(rows: T[], today: string): T[] {
  return sortReminders(rows.filter(row => row.status === 'pending' && row.date <= today))
    .sort((a, b) => a.date.localeCompare(b.date))
}
