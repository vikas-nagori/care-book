import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { TempPasswordDialog } from './temp-password-dialog'

const CREDENTIALS = { mobileNumber: null, email: 'owner@example.com', tempPassword: 'Abcdef23456789' }

function setViewport(desktop: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: desktop,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  })
}

function setShareSheet(share: ((data: ShareData) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'share', { configurable: true, value: share })
}

describe('TempPasswordDialog', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, { clipboard: { writeText } })
    writeText.mockResolvedValue(undefined)
    setViewport(false)
    setShareSheet(undefined)
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

  it('leads with the phone share sheet, sending a ready-to-send login message', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    setShareSheet(share)
    render(<TempPasswordDialog credentials={CREDENTIALS} onClose={() => {}} />)

    // The first action (ignoring the sheet's own close control) is Share.
    const actions = screen
      .getAllByRole('button')
      .map((button) => button.textContent?.trim())
      .filter((label) => label && label !== 'Close')
    expect(actions).toEqual(['Share login', 'Copy login details', 'Done'])

    fireEvent.click(screen.getByRole('button', { name: 'Share login' }))

    await waitFor(() => expect(screen.getByText('Login details shared.')).toBeTruthy())
    const { text } = share.mock.calls[0][0] as ShareData
    expect(text).toContain(`${window.location.origin}/login`)
    expect(text).toContain('Email: owner@example.com')
    expect(text).toContain(`Temporary password: ${CREDENTIALS.tempPassword}`)
  })

  it('treats a cancelled share sheet as nothing happening', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    setShareSheet(vi.fn().mockRejectedValue(abort))
    render(<TempPasswordDialog credentials={CREDENTIALS} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Share login' }))

    await waitFor(() => expect(writeText).not.toHaveBeenCalled())
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('falls back to copying when sharing fails', async () => {
    setShareSheet(vi.fn().mockRejectedValue(new Error('NotAllowedError')))
    render(<TempPasswordDialog credentials={CREDENTIALS} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Share login' }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
  })

  it('copies the full login message when there is no share sheet', async () => {
    render(<TempPasswordDialog credentials={CREDENTIALS} onClose={() => {}} />)

    expect(screen.queryByRole('button', { name: 'Share login' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Copy login details' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining(CREDENTIALS.tempPassword))
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Email: owner@example.com'))
      expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    })
  })

  it('offers manual copy guidance when the clipboard is unavailable', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    render(<TempPasswordDialog credentials={CREDENTIALS} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy login details' }))

    await waitFor(() => {
      expect(screen.getByText(/copy it manually/i)).toBeTruthy()
    })
  })

  it('cannot be dismissed with Escape before the details are shared or copied', async () => {
    const onClose = vi.fn()
    render(<TempPasswordDialog credentials={CREDENTIALS} onClose={onClose} />)

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Copy login details' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('closes via the Done button on both layouts', () => {
    for (const desktop of [false, true]) {
      setViewport(desktop)
      const onClose = vi.fn()
      render(<TempPasswordDialog credentials={CREDENTIALS} onClose={onClose} />)

      fireEvent.click(screen.getByRole('button', { name: 'Done' }))

      expect(onClose).toHaveBeenCalled()
      cleanup()
    }
  })
})
