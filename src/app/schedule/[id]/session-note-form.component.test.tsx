import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ save: vi.fn(), toast: vi.fn() }))
vi.mock('../actions', () => ({ saveSessionNote: mocks.save }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))

import { SessionNoteForm } from './session-note-form'

describe('SessionNoteForm', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('sends one save for two submits in the same tick (G-4 double tap)', async () => {
    let finish: (value: { success: true }) => void = () => {}
    mocks.save.mockReturnValue(new Promise((done) => { finish = done }))
    const onSuccess = vi.fn()
    render(<SessionNoteForm appointmentId="appointment-1" onSuccess={onSuccess} />)
    fireEvent.change(screen.getByLabelText('Subjective'), { target: { value: 'Better today' } })
    const form = screen.getByLabelText('Subjective').closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    finish({ success: true })
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })

  it('can be saved again after a failure', async () => {
    mocks.save.mockResolvedValueOnce({ success: false, errorCode: 'SESSION_NOTE_SAVE_FAILED', message: 'Unable to save session notes right now.' })
    mocks.save.mockResolvedValueOnce({ success: true })
    const onSuccess = vi.fn()
    render(<SessionNoteForm appointmentId="appointment-1" onSuccess={onSuccess} />)
    const form = screen.getByLabelText('Subjective').closest('form')!
    fireEvent.submit(form)
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Notes' })).toHaveProperty('disabled', false))
    fireEvent.submit(form)
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(mocks.save).toHaveBeenCalledTimes(2)
  })
})
