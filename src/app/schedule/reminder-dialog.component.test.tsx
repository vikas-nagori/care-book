import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ status: vi.fn(), remove: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('./reminder-actions', () => ({ setReminderStatus: mocks.status, deleteReminder: mocks.remove }))
vi.mock('./reminder-form', () => ({ ReminderForm: () => <p>Edit form</p> }))
import { ReminderDialog } from './reminder-dialog'
import type { CalendarReminder } from '@/lib/supabase/types'
const reminder = { id: 'r1', title: 'Call back', date: '2026-09-05', time: null, status: 'pending', contact_name: 'Riya', patient: null } as CalendarReminder
afterEach(cleanup)
beforeEach(() => { mocks.status.mockResolvedValue({ success: true }); mocks.remove.mockResolvedValue({ success: true }) })
function show(status = 'pending') { render(<ReminderDialog open onOpenChange={vi.fn()} patients={[]} defaultDate="2026-09-05" reminder={{ ...reminder, status } as CalendarReminder} />) }
it('completes a reminder and refreshes the schedule', async () => {
  show()
  fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }))
  await waitFor(() => expect(mocks.status).toHaveBeenCalledWith('r1', 'completed'))
  expect(mocks.refresh).toHaveBeenCalled()
})
it('reopens completed reminders', async () => {
  show('completed')
  fireEvent.click(screen.getByRole('button', { name: 'Reopen reminder' }))
  await waitFor(() => expect(mocks.status).toHaveBeenCalledWith('r1', 'pending'))
})
it('requires confirmation before deleting', async () => {
  show()
  fireEvent.click(screen.getByRole('button', { name: 'Delete reminder' }))
  expect(mocks.remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Keep reminder' }))
  expect(mocks.remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Delete reminder' }))
  fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('r1'))
})
it('keeps the details open and displays failed mutation errors', async () => {
  mocks.status.mockResolvedValue({ success: false, message: 'Please retry.' })
  show()
  fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Please retry.'))
  expect(mocks.refresh).not.toHaveBeenCalled()
})
