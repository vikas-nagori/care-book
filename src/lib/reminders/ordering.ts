import type { Reminder } from '../supabase/types.ts'

export function sortReminders<T extends Pick<Reminder, 'id' | 'status' | 'time' | 'created_at'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    Number(a.status === 'completed') - Number(b.status === 'completed') ||
    (a.time ?? '').localeCompare(b.time ?? '') ||
    a.created_at.localeCompare(b.created_at) ||
    a.id.localeCompare(b.id)
  )
}
