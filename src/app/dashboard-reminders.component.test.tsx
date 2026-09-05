import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
vi.mock('./schedule/reminder-dialog', () => ({
  ReminderDialog: ({ open, reminder }: { open: boolean; reminder?: { title: string } }) => open ? <p>Dialog for {reminder?.title}</p> : null,
}))
import { DashboardReminders } from './dashboard-reminders'
import type { CalendarReminder } from '@/lib/supabase/types'
afterEach(cleanup)
const base = { time: null, status: 'pending', contact_name: null, patient: null, created_at: '2026-09-01' } as unknown as CalendarReminder
const today = { ...base, id: 'today', title: 'Call inquiry', date: '2026-09-05', contact_name: 'Riya' }
const overdue = { ...base, id: 'old', title: 'Chase report', date: '2026-09-03', time: '10:30:00', patient: { id: 'p1', name: 'Arjun Shah' } }
const done = { ...base, id: 'done', title: 'Finished task', date: '2026-09-05', status: 'completed' as const }
const future = { ...base, id: 'future', title: 'Tomorrow task', date: '2026-09-06' }

it('renders nothing when no reminder is due', () => {
  const { container } = render(<DashboardReminders reminders={[done, future]} patients={[]} today="2026-09-05" />)
  expect(container.innerHTML).toBe('')
})
it('lists pending reminders due today or earlier and flags the overdue ones', () => {
  render(<DashboardReminders reminders={[today, overdue, done, future]} patients={[]} today="2026-09-05" />)
  const region = screen.getByRole('region', { name: "Today's reminders" })
  expect(region.textContent).toContain('Reminders · 2')
  const buttons = screen.getAllByRole('button')
  expect(buttons.map(button => button.textContent)).toEqual([
    expect.stringContaining('Chase report'),
    expect.stringContaining('Call inquiry'),
  ])
  expect(buttons[0].textContent).toContain('Overdue · 3 Sep')
  expect(buttons[0].textContent).toContain('10:30')
  expect(buttons[0].textContent).toContain('Arjun Shah · Patient')
  expect(buttons[1].textContent).toContain('Any time')
  expect(buttons[1].textContent).not.toContain('Overdue')
  expect(screen.queryByText('Finished task')).toBeNull()
  expect(screen.queryByText('Tomorrow task')).toBeNull()
})
it('opens the reminder dialog for the chosen reminder', () => {
  render(<DashboardReminders reminders={[today]} patients={[]} today="2026-09-05" />)
  fireEvent.click(screen.getByRole('button', { name: /Call inquiry/ }))
  expect(screen.getByText('Dialog for Call inquiry')).toBeTruthy()
})
it('reports a load failure instead of hiding the section', () => {
  render(<DashboardReminders reminders={[]} patients={[]} today="2026-09-05" loadError />)
  expect(screen.getByRole('alert').textContent).toContain('Could not load reminders')
})
