import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ACTION_UNREACHABLE_MESSAGE } from '@/lib/actions/run-server-action'

const mocks = vi.hoisted(() => ({
  logoutFromSettings: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('next/navigation', async (importOriginal) => ({
  // Keep the real unstable_* helpers: callServerAction uses them to classify a rejected action.
  ...(await importOriginal<typeof import('next/navigation')>()),
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('./actions', () => ({ logoutFromSettings: mocks.logoutFromSettings }))
vi.mock('@/lib/observability/report-client-error', () => ({ reportClientError: vi.fn() }))

import { LogoutButton } from './logout-button'

describe('LogoutButton (G-15)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it('shows the failure message and comes back usable when the request is dropped', async () => {
    mocks.logoutFromSettings.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<LogoutButton />)

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Not logged out',
      description: ACTION_UNREACHABLE_MESSAGE,
      variant: 'destructive',
    })))
    const button = screen.getByRole('button', { name: 'Logout' })
    expect(button).toHaveProperty('disabled', false)
  })

  it('stays pending and sends one request however often it is tapped', async () => {
    mocks.logoutFromSettings.mockReturnValue(new Promise(() => {}))
    render(<LogoutButton />)

    const button = screen.getByRole('button', { name: 'Logout' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Logging out…' })).toHaveProperty('disabled', true))
    expect(mocks.logoutFromSettings).toHaveBeenCalledTimes(1)
    expect(mocks.toast).not.toHaveBeenCalled()
  })
})
