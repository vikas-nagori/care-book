import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => mocks }))
vi.mock('./appointment-form', () => ({ AppointmentForm: () => <p>Appointment form</p> }))
vi.mock('./reminder-dialog', () => ({ ReminderDialog: ({ open }: { open: boolean }) => open ? <p>Reminder form</p> : null }))
import { ScheduleView } from './schedule-view'
import type { CalendarReminder } from '@/lib/supabase/types'
afterEach(cleanup)
const reminder = { id: 'r1', title: 'Inquiry call', date: '2026-09-05', time: null, status: 'pending', contact_name: 'Riya', patient: null, created_at: '2026-09-01' } as CalendarReminder
const props = { initialSelectedDate: '2026-09-05', todayDate: '2026-09-05', initialAppointments: [], patients: [], doctors: [], assigneeOptions: [], externalStaffOptions: [], currentProfileId: null, canManageExternalStaff: false, canViewPaymentSignals: false }
it('preserves appointment creation and separately opens reminders', () => {
  render(<ScheduleView {...props} initialReminders={[reminder]} />)
  expect(screen.getByRole('button', { name: 'New Appointment' })).toBeTruthy()
  expect(screen.getByText('0 appointments')).toBeTruthy()
  expect(screen.getByRole('button', { name: /Inquiry call/ })).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: 'Add reminder' })[0])
  expect(screen.getByText('Reminder form')).toBeTruthy()
})
it('only shows reminders belonging to the selected date', () => {
  render(<ScheduleView {...props} initialReminders={[{ ...reminder, date: '2026-09-06' }]} />)
  expect(screen.queryByText('Inquiry call')).toBeNull()
  expect(screen.getByText('No reminders for this day.')).toBeTruthy()
})
