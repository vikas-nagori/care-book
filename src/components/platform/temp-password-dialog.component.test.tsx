import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { TempPasswordDialog } from './temp-password-dialog'

const CREDENTIALS = { email: 'owner@example.com', tempPassword: 'Abcdef23456789' }

describe('TempPasswordDialog', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, { clipboard: { writeText } })
    writeText.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the issued credentials with a one-time warning', () => {
    render(<TempPasswordDialog credentials={CREDENTIALS} onClose={() => {}} />)

    expect(screen.getByText('owner@example.com')).toBeTruthy()
    expect(screen.getByTestId('temp-password').textContent).toBe(CREDENTIALS.tempPassword)
    expect(screen.getByText(/shown only once/i)).toBeTruthy()
  })

  it('stays closed without credentials', () => {
    render(<TempPasswordDialog credentials={null} onClose={() => {}} />)

    expect(screen.queryByTestId('temp-password')).toBeNull()
  })

  it('copies the password to the clipboard', async () => {
    render(<TempPasswordDialog credentials={CREDENTIALS} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy password' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(CREDENTIALS.tempPassword)
      expect(screen.getByRole('button', { name: 'Copied!' })).toBeTruthy()
    })
  })

  it('offers manual copy guidance when the clipboard is unavailable', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    render(<TempPasswordDialog credentials={CREDENTIALS} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy password' }))

    await waitFor(() => {
      expect(screen.getByText(/copy it manually/i)).toBeTruthy()
    })
  })

  it('closes via the Done button', () => {
    const onClose = vi.fn()
    render(<TempPasswordDialog credentials={CREDENTIALS} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(onClose).toHaveBeenCalled()
  })
})
