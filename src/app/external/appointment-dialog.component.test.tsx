import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ExternalAppointment } from '@/lib/external/types'

const mocks = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('./actions', () => ({ updateExternalAppointment: mocks.update }))

import { ExternalAppointmentDialog } from './appointment-dialog'

const appointment: ExternalAppointment = {
  id: '11111111-1111-4111-8111-111111111111',
  patient_id: '22222222-2222-4222-8222-222222222222',
  patient_name: 'Leela',
  appointment_type_id: '33333333-3333-4333-8333-333333333333',
  date: '2030-01-10',
  time: '10:00:00',
  duration_minutes: 45,
  type: 'Clinic',
  status: 'scheduled',
}
const types = [{ id: appointment.appointment_type_id, name: 'Clinic' }, { id: '44444444-4444-4444-8444-444444444444', name: 'Home' }]

function mount(overrides: Partial<ExternalAppointment> = {}, timeZone = 'Asia/Kolkata') {
  const props = {
    appointment: { ...appointment, ...overrides },
    types,
    minDate: '2030-01-01',
    timeZone,
    returnFocus: document.body,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    onDenied: vi.fn(),
  }
  render(<ExternalAppointmentDialog {...props} />)
  return props
}

describe('ExternalAppointmentDialog', () => {
  beforeEach(() => { mocks.update.mockResolvedValue({ success: true, appointment }) })
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('reschedules in the viewer zone and sends clinic date and time', async () => {
    const props = mount({}, 'Europe/London')
    // 10:00 IST is 04:30 in London in January.
    expect((screen.getByLabelText('Time') as HTMLInputElement).value).toBe('04:30')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2030-01-12' } })
    fireEvent.change(screen.getByLabelText('Appointment type'), { target: { value: types[1].id } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({
      id: appointment.id, appointment_type_id: types[1].id, date: '2030-01-12', time: '10:00',
      duration_minutes: 45, status: 'scheduled',
    }))
    expect(props.onSaved).toHaveBeenCalledWith('Appointment updated', '2030-01-12')
  })

  it('cancels after confirmation by restating the stored appointment', async () => {
    const props = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel appointment' }))
    expect(mocks.update).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel appointment' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({
      id: appointment.id, appointment_type_id: appointment.appointment_type_id, date: '2030-01-10', time: '10:00',
      duration_minutes: 45, status: 'cancelled',
    }))
    expect(props.onSaved).toHaveBeenCalledWith('Appointment cancelled', '2030-01-10')
  })

  it('shows the server message and hands access loss back to the page', async () => {
    mocks.update.mockResolvedValueOnce({ success: false, message: 'You already have an appointment for this patient at that time.' })
    const props = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect((await screen.findByRole('alert')).textContent).toContain('already have an appointment')
    mocks.update.mockResolvedValueOnce({ success: false, accessDenied: true, message: 'x' })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(props.onDenied).toHaveBeenCalled())
  })

  it('is read-only for completed, cancelled and past appointments', () => {
    mount({ status: 'completed' })
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(screen.getByText(/completed and can’t be changed/)).toBeTruthy()
    cleanup()
    mount({ date: '2029-12-31' })
    expect(screen.queryByRole('button', { name: 'Cancel appointment' })).toBeNull()
    expect(screen.getByText(/Past appointments can’t be changed/)).toBeTruthy()
  })
})
