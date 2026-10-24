import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AppointmentType } from '@/lib/supabase/types'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(), event: vi.fn(), resolveReferral: vi.fn(),
  from: vi.fn(), order: vi.fn(),
  oldAction: vi.fn(() => new Promise(() => {})),
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('./actions', () => ({ createAppointment: mocks.oldAction }))
vi.mock('@/lib/observability/report-booking-event', () => ({ reportBookingEvent: mocks.event }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: mocks.from }) }))
vi.mock('@/components/referral/referral-fields', () => ({
  ReferralFields: () => null,
  useReferralSelection: () => ({ referralSource: '', resolveReferral: mocks.resolveReferral }),
}))

import { AppointmentForm } from './appointment-form'

const patientId = '11111111-1111-4111-8111-111111111111'
const appointmentId = '22222222-2222-4222-8222-222222222222'
const type: AppointmentType = {
  id: '33333333-3333-4333-8333-333333333333', clinic_id: 'clinic', name: 'Clinic Visit',
  session_rate: 800, is_shared: true, is_default: true, sort_order: 0, created_at: '',
}
const props = {
  patients: [{ id: patientId, name: 'Test Patient' }], defaultPatientId: patientId,
  defaultDate: '2026-11-01', canViewPaymentSignals: true as const, initialAppointmentTypes: [type],
}
const booked = () => new Response(JSON.stringify({ success: true, appointmentIds: [appointmentId] }))
function submit() {
  fireEvent.submit(screen.getByLabelText('Time *').closest('form')!)
}
// Every automatic attempt fails, as in a real outage, so the manual recovery controls appear.
async function submitThroughOutage() {
  for (let attempt = 0; attempt < 4; attempt++) vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Network interrupted'))
  vi.useFakeTimers()
  submit()
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
  vi.useRealTimers()
}
const stall = (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
})
async function mount(onSuccess = vi.fn()) {
  const view = render(<AppointmentForm {...props} onSuccess={onSuccess} />)
  await waitFor(() => expect((screen.getByLabelText('Session Fee (₹)') as HTMLInputElement).value).toBe('800'))
  return { ...view, onSuccess }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn()); mocks.event.mockClear(); mocks.toast.mockClear()
  mocks.order.mockResolvedValue({ data: [], error: null })
  mocks.from.mockReturnValue({ select: () => ({ order: mocks.order }) })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('appointment save recovery', () => {
  it('reports failed appointment options and lets the user reload them', async () => {
    mocks.order.mockRejectedValueOnce(new TypeError('private option data'))
    render(<AppointmentForm {...props} initialAppointmentTypes={undefined} />)
    const reload = await screen.findByRole('button', { name: 'Reload appointment types' })
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ phase: 'options_failed' }))
    mocks.order.mockResolvedValueOnce({ data: [type], error: null })
    fireEvent.click(reload)
    await waitFor(() => expect((screen.getByLabelText('Session Fee (₹)') as HTMLInputElement).value).toBe('800'))
    expect(screen.queryByRole('button', { name: 'Reload appointment types' })).toBeNull()
    expect(JSON.stringify(mocks.event.mock.calls)).not.toContain('private option data')
  })
  it('books sequential appointments through independent requests with distinct attempt IDs', async () => {
    vi.mocked(fetch).mockImplementation(async () => booked())
    const { onSuccess } = await mount()
    submit()
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('Time *'), { target: { value: '15:00' } })
    submit()
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(2))
    const calls = vi.mocked(fetch).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls.every(call => call[0] === '/api/appointments/bookings')).toBe(true)
    const requests = calls.map(call => JSON.parse(String(call[1]?.body)))
    expect(requests[0].correlationId).not.toBe(requests[1].correlationId)
    expect(requests[1].input.time).toBe('15:00')
    expect(mocks.oldAction).not.toHaveBeenCalled()
  })

  it('blocks duplicate clicks before React updates the button', async () => {
    let complete!: (value: Response) => void
    vi.mocked(fetch).mockReturnValue(new Promise(resolve => { complete = resolve }))
    const { onSuccess } = await mount()
    submit(); submit()
    expect(fetch).toHaveBeenCalledTimes(1)
    complete(booked())
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })

  it('resends a booking stuck on a dead connection and confirms it without the recovery popup', async () => {
    vi.mocked(fetch).mockImplementationOnce(stall).mockResolvedValueOnce(booked())
    const { onSuccess } = await mount()
    vi.useFakeTimers()
    submit()
    await act(async () => { await vi.advanceTimersByTimeAsync(6_001) })
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Booking not confirmed')).toBeNull()
    const calls = vi.mocked(fetch).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1][0]).toBe('/api/appointments/bookings')
    expect(JSON.parse(String(calls[1][1]?.body))).toEqual(JSON.parse(String(calls[0][1]?.body)))
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ phase: 'auto_retry', errorCode: 'BOOKING_TIMEOUT' }))
  })

  it('resends at once when the connection drops, confirming a booking whose reply was lost', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Load failed')).mockResolvedValueOnce(booked())
    const { onSuccess } = await mount()
    submit()
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Booking not confirmed')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('stops resending once the form is closed', async () => {
    vi.mocked(fetch).mockImplementation(stall)
    const { unmount } = await mount()
    vi.useFakeTimers()
    submit(); unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(30_001) })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('recovers from network rejection with preserved fields and a check-booking action', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch private-data'))
    const { onSuccess } = await mount()
    vi.useFakeTimers()
    submit()
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    vi.useRealTimers()
    expect(fetch).toHaveBeenCalledTimes(4)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check booking' }).hasAttribute('disabled')).toBe(false))
    expect(screen.queryByText('Saving…')).toBeNull()
    expect((screen.getByLabelText('Time *') as HTMLInputElement).value).toBe('09:00')
    expect(onSuccess).not.toHaveBeenCalled()
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ phase: 'unconfirmed' }))
    expect(JSON.stringify(mocks.event.mock.calls)).not.toContain('private-data')
  })

  it('gives up resending after 30 seconds and confirms a committed booking with a status check, not another write', async () => {
    vi.mocked(fetch).mockImplementation(stall)
    const { onSuccess } = await mount()
    vi.useFakeTimers()
    submit()
    await act(async () => { await vi.advanceTimersByTimeAsync(29_000) })
    expect(screen.getByText('Saving…')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(1_001) })
    expect(screen.queryByText('Saving…')).toBeNull()
    expect(screen.getByRole('button', { name: 'Check booking' }).hasAttribute('disabled')).toBe(false)
    expect(onSuccess).not.toHaveBeenCalled()
    const writes = vi.mocked(fetch).mock.calls.length
    expect(writes).toBe(4)
    vi.mocked(fetch).mockResolvedValueOnce(booked())
    fireEvent.click(screen.getByRole('button', { name: 'Check booking' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(onSuccess).toHaveBeenCalledTimes(1)
    const calls = vi.mocked(fetch).mock.calls
    expect(calls).toHaveLength(writes + 1)
    expect(calls[writes][0]).toBe('/api/appointments/bookings/status')
    for (const call of calls) expect(JSON.parse(String(call[1]?.body))).toEqual(JSON.parse(String(calls[0][1]?.body)))
  })

  it('retries only after a status check and reuses the entire original request', async () => {
    const { onSuccess } = await mount()
    await submitThroughOutage()
    await screen.findByRole('button', { name: 'Check booking' })
    expect(screen.queryByRole('button', { name: 'Retry same booking' })).toBeNull()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ success: false, errorCode: 'BOOKING_NOT_FOUND', message: 'Not saved yet.' })))
    fireEvent.click(screen.getByRole('button', { name: 'Check booking' }))
    const retry = await screen.findByRole('button', { name: 'Retry same booking' })
    vi.mocked(fetch).mockResolvedValueOnce(booked())
    fireEvent.click(retry)
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    const bodies = vi.mocked(fetch).mock.calls.map(call => JSON.parse(String(call[1]?.body)))
    expect(bodies[5]).toEqual(bodies[0])
    expect(fetch).toHaveBeenCalledTimes(6)
  })

  it('ignores a response after the form unmounts', async () => {
    let complete!: (value: Response) => void
    vi.mocked(fetch).mockReturnValue(new Promise(resolve => { complete = resolve }))
    const { onSuccess, unmount } = await mount()
    submit(); unmount()
    await act(async () => { complete(booked()); await Promise.resolve() })
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('preserves an uncertain attempt when its status check is denied', async () => {
    await mount()
    await submitThroughOutage()
    await screen.findByRole('button', { name: 'Check booking' })
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ success: false, errorCode: 'SCHEDULE_UNAUTHORIZED', message: 'Sign in again.' }), { status: 401 }))
    fireEvent.click(screen.getByRole('button', { name: 'Check booking' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Unable to check booking' })))
    expect(screen.getByText('Booking not confirmed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry same booking' })).toBeNull()
    submit()
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it('keeps the original attempt after a failed retry while an earlier write may still complete', async () => {
    await mount()
    await submitThroughOutage()
    await screen.findByRole('button', { name: 'Check booking' })
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ success: false, errorCode: 'BOOKING_NOT_FOUND', message: 'Not found yet.' }), { status: 404 }))
    fireEvent.click(screen.getByRole('button', { name: 'Check booking' }))
    const retry = await screen.findByRole('button', { name: 'Retry same booking' })
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ success: false, errorCode: 'APPOINTMENT_CREATE_FAILED', message: 'Unable to check the appointment schedule.' }), { status: 400 }))
    fireEvent.click(retry)
    await waitFor(() => expect(screen.queryByText('Checking…')).toBeNull())
    expect(screen.getByText('Booking not confirmed')).toBeTruthy()
    submit()
    expect(fetch).toHaveBeenCalledTimes(6)
    vi.mocked(fetch).mockResolvedValueOnce(booked())
    fireEvent.click(screen.getByRole('button', { name: 'Check booking' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(7))
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[6][1]?.body))).toEqual(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)))
  })

  it('catches inline patient preparation errors before any booking request', async () => {
    mocks.resolveReferral.mockRejectedValueOnce(new Error('private referral detail'))
    render(<AppointmentForm {...props} patients={[]} defaultPatientId={undefined} />)
    await waitFor(() => expect((screen.getByLabelText('Session Fee (₹)') as HTMLInputElement).value).toBe('800'))
    fireEvent.change(screen.getByLabelText('Patient *'), { target: { value: 'New Patient' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create new patient: "New Patient"' }))
    fireEvent.change(screen.getByLabelText('Phone *'), { target: { value: '9876543210' } })
    submit()
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Unable to prepare appointment' })))
    expect(screen.queryByText('Saving…')).toBeNull()
    expect((screen.getByLabelText('Name *') as HTMLInputElement).value).toBe('New Patient')
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ phase: 'preparation_failed', errorCode: 'BOOKING_PREPARATION_FAILED' }))
    expect(JSON.stringify(mocks.event.mock.calls)).not.toContain('private referral detail')
  })
})
