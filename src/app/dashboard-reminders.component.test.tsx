import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const options = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('./dashboard-actions', () => ({ getDashboardReminderPatients: options.load }))
vi.mock('./schedule/reminder-dialog', () => ({
  ReminderDialog: ({ open, reminder }: { open: boolean; reminder?: { title: string } }) => open ? <p>Dialog for {reminder?.title}</p> : null,
}))
import { DashboardReminders } from './dashboard-reminders'
import type { CalendarReminder } from '@/lib/supabase/types'
afterEach(cleanup)
beforeEach(() => options.load.mockResolvedValue({ ok: true, patients: [] }))
const base = { time: null, status: 'pending', contact_name: null, patient: null, created_at: '2026-09-01' } as unknown as CalendarReminder
const today = { ...base, id: 'today', title: 'Call inquiry', date: '2026-09-05', contact_name: 'Riya' }
const overdue = { ...base, id: 'old', title: 'Chase report', date: '2026-09-03', time: '10:30:00', patient: { id: 'p1', name: 'Arjun Shah' } }
const done = { ...base, id: 'done', title: 'Finished task', date: '2026-09-05', status: 'completed' as const }
const future = { ...base, id: 'future', title: 'Tomorrow task', date: '2026-09-06' }

it('renders nothing when no reminder is due', () => {
  const { container } = render(<DashboardReminders reminders={[done, future]} today="2026-09-05" />)
  expect(container.innerHTML).toBe('')
})
it('lists pending reminders due today or earlier and flags the overdue ones', () => {
  render(<DashboardReminders reminders={[today, overdue, done, future]} today="2026-09-05" />)
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
it('loads patient options only when opening a reminder', async () => {
  render(<DashboardReminders reminders={[today]} today="2026-09-05" />)
  expect(options.load).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /Call inquiry/ }))
  await waitFor(() => expect(options.load).toHaveBeenCalledOnce())
  expect(await screen.findByText('Dialog for Call inquiry')).toBeTruthy()
})
it('shows an option-load failure and allows retry without an empty editor', async () => {
  options.load.mockResolvedValueOnce({ ok: false })
  render(<DashboardReminders reminders={[today]} today="2026-09-05" />)
  fireEvent.click(screen.getByRole('button', { name: /Call inquiry/ }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText('Dialog for Call inquiry')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Call inquiry/ }))
  expect(await screen.findByText('Dialog for Call inquiry')).toBeTruthy()
})
it('reports a load failure instead of hiding the section', () => {
  render(<DashboardReminders reminders={[]} today="2026-09-05" loadError />)
  expect(screen.getByRole('alert').textContent).toContain('Could not load reminders')
})
