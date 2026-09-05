import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }))
vi.mock('./reminder-actions', () => ({ createReminder: mocks.create, updateReminder: mocks.update }))
import { ReminderForm } from './reminder-form'
afterEach(cleanup)
beforeEach(() => mocks.create.mockResolvedValue({ success: true }))
const patients = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Arjun Shah' }]
it('saves a title and date without creating a patient', async () => {
  const onSuccess = vi.fn()
  render(<ReminderForm patients={patients} defaultDate="2026-09-05" onSuccess={onSuccess} />)
  fireEvent.change(screen.getByLabelText('What needs following up?'), { target: { value: 'Call back' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }))
  await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Call back', date: '2026-09-05', patientId: null }))
})
it('links a searched existing patient and clears the link when switching back', async () => {
  render(<ReminderForm patients={patients} defaultDate="2026-09-05" onSuccess={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Existing patient' }))
  fireEvent.click(screen.getByLabelText('Patient'))
  fireEvent.change(screen.getByPlaceholderText('Search patients…'), { target: { value: 'arjun' } })
  fireEvent.click(screen.getByRole('button', { name: 'Arjun Shah' }))
  expect(screen.getByLabelText('Patient').textContent).toContain('Arjun Shah')
  fireEvent.click(screen.getByRole('button', { name: 'Name only' }))
  fireEvent.change(screen.getByLabelText('What needs following up?'), { target: { value: 'Check in' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }))
  await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ patientId: null })))
})
it('retains entered fields on a failed save', async () => {
  mocks.create.mockResolvedValue({ success: false, message: 'Please try again.' })
  render(<ReminderForm patients={patients} defaultDate="2026-09-05" onSuccess={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('What needs following up?'), { target: { value: 'Keep this text' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Please try again.'))
  expect((screen.getByLabelText('What needs following up?') as HTMLInputElement).value).toBe('Keep this text')
})
it('filters patients from the picker search and saves the chosen link', async () => {
  const roster = [...patients, { id: '22222222-2222-4222-8222-222222222222', name: 'Bina Rao' }]
  render(<ReminderForm patients={roster} defaultDate="2026-09-05" onSuccess={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Existing patient' }))
  fireEvent.click(screen.getByLabelText('Patient'))
  fireEvent.change(screen.getByPlaceholderText('Search patients…'), { target: { value: 'bina' } })
  expect(screen.queryByRole('button', { name: 'Arjun Shah' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Bina Rao' }))
  fireEvent.change(screen.getByLabelText('What needs following up?'), { target: { value: 'Review plan' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }))
  await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ patientId: roster[1].id })))
})
it('asks for a patient before saving in existing-patient mode', async () => {
  render(<ReminderForm patients={patients} defaultDate="2026-09-05" onSuccess={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Existing patient' }))
  fireEvent.change(screen.getByLabelText('What needs following up?'), { target: { value: 'Call' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Choose a patient'))
  expect(mocks.create).not.toHaveBeenCalled()
})
