import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ExternalAppointment, ExternalWorkspace } from '@/lib/external/types'

const mocks = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn(), refresh: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('./actions', () => ({ updateExternalAppointment: mocks.update, createExternalAppointment: mocks.create }))

import { ExternalSchedule } from './external-schedule'

const DATE = '2030-01-10'
const appointment: ExternalAppointment = {
  id: '11111111-1111-4111-8111-111111111111',
  patient_id: '22222222-2222-4222-8222-222222222222',
  patient_name: 'Leela Test',
  appointment_type_id: '33333333-3333-4333-8333-333333333333',
  date: DATE,
  time: '10:00:00',
  duration_minutes: 45,
  type: 'Clinic',
  status: 'scheduled',
}
const workspace: ExternalWorkspace = {
  patients: [{ id: appointment.patient_id, name: appointment.patient_name, phone: null, dob: null, age_years: null, age_recorded_on: null, gender: null, email: null, address: null }],
  appointments: [appointment],
  appointment_types: [{ id: appointment.appointment_type_id, name: 'Clinic' }],
}

function mount(ws: ExternalWorkspace = workspace) {
  const props = { selectedDate: DATE, todayDate: '2030-01-01', railDates: ['2030-01-01', '2030-01-31'], timeZone: 'Asia/Kolkata' }
  const view = render(<ExternalSchedule workspace={ws} {...props} />)
  return { rerender: (next: ExternalWorkspace) => view.rerender(<ExternalSchedule workspace={next} {...props} />) }
}

function openChip() {
  fireEvent.click(screen.getByRole('button', { name: /Leela Test/ }))
  return screen.getByRole('dialog')
}

describe('ExternalSchedule', () => {
  beforeEach(() => {
    mocks.update.mockImplementation(async (request: { duration_minutes: number; status: ExternalAppointment['status'] }) => ({
      success: true,
      appointment: { ...appointment, duration_minutes: request.duration_minutes, status: request.status },
    }))
  })
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('cancels the rescheduled slot when reopened before the refresh lands (G-20)', async () => {
    mount()
    let dialog = openChip()
    fireEvent.change(within(dialog).getByLabelText('Duration (minutes)'), { target: { value: '50' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.refresh).toHaveBeenCalledTimes(1)

    // The workspace prop is still the pre-save one: the refresh has not landed.
    expect(screen.getByRole('button', { name: /Leela Test/ }).textContent).toContain('50m')
    dialog = openChip()
    expect((within(dialog).getByLabelText('Duration (minutes)') as HTMLInputElement).value).toBe('50')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel appointment' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel appointment' }))
    await waitFor(() => expect(mocks.update).toHaveBeenLastCalledWith({
      id: appointment.id, appointment_type_id: appointment.appointment_type_id, date: DATE, time: '10:00',
      duration_minutes: 50, status: 'cancelled',
    }))
  })

  it('shows the refreshed workspace once it arrives', async () => {
    const { rerender } = mount()
    const dialog = openChip()
    fireEvent.change(within(dialog).getByLabelText('Duration (minutes)'), { target: { value: '50' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // The server's refreshed copy wins over the saved row (here, the clinic changed it again).
    rerender({ ...workspace, appointments: [{ ...appointment, duration_minutes: 90 }] })
    expect(screen.getByRole('button', { name: /Leela Test/ }).textContent).toContain('90m')
  })
})
