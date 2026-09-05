import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReminderList } from './reminder-list'
import type { CalendarReminder } from '@/lib/supabase/types'
afterEach(cleanup)
const reminder = { id: 'r1', title: 'Call inquiry', date: '2026-09-05', time: null, status: 'pending', contact_name: 'Riya', patient: null, created_at: '2026-09-01' } as CalendarReminder
it('shows a compact empty state', () => {
  render(<ReminderList reminders={[]} onSelect={vi.fn()} />)
  expect(screen.getByText('No reminders for this day.')).toBeTruthy()
})
it('shows any-time reminders by default and supports collapse and opening', () => {
  const onSelect = vi.fn()
  render(<ReminderList reminders={[reminder]} onSelect={onSelect} />)
  expect(screen.getByText(/Any time/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Call inquiry/ }))
  expect(onSelect).toHaveBeenCalledWith(reminder)
  fireEvent.click(screen.getByRole('button', { name: /Reminders/ }))
  expect(screen.queryByRole('button', { name: /Call inquiry/ })).toBeNull()
})
it('reports a load failure instead of an empty state', () => {
  render(<ReminderList reminders={[]} loadError onSelect={vi.fn()} />)
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(screen.queryByText('No reminders for this day.')).toBeNull()
})
