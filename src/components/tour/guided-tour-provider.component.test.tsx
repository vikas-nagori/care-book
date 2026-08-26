import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  guidedTour: vi.fn(),
}))

vi.mock('next/navigation', () => ({ usePathname: mocks.usePathname }))
vi.mock('./guided-tour', () => ({
  GuidedTour: (props: { open: boolean }) => {
    mocks.guidedTour(props.open)
    return null
  },
}))

import { GuidedTourProvider } from './guided-tour-provider'

// The test environment's localStorage lacks parts of the Storage API, so back it with a Map.
function installLocalStorage() {
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
    },
  })
}

describe('GuidedTourProvider first-run auto-open', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installLocalStorage()
  })

  afterEach(() => {
    cleanup()
  })

  it('auto-opens once on an app route for a device that has never seen it', () => {
    mocks.usePathname.mockReturnValue('/')

    render(
      <GuidedTourProvider role="admin">
        <div />
      </GuidedTourProvider>
    )

    expect(mocks.guidedTour).toHaveBeenLastCalledWith(true)
    expect(window.localStorage.getItem('care-book:guided-tour-seen')).toBe('true')
  })

  it('never auto-opens over auth-flow screens, and defers the first run instead of consuming it', () => {
    mocks.usePathname.mockReturnValue('/auth/change-password')

    render(
      <GuidedTourProvider role="admin">
        <div />
      </GuidedTourProvider>
    )

    expect(mocks.guidedTour).toHaveBeenLastCalledWith(false)
    // The seen flag stays unset so the tour still greets the user on the dashboard afterwards.
    expect(window.localStorage.getItem('care-book:guided-tour-seen')).toBeNull()
  })

  it('does not reopen on an app route once the tour has been seen', () => {
    window.localStorage.setItem('care-book:guided-tour-seen', 'true')
    mocks.usePathname.mockReturnValue('/')

    render(
      <GuidedTourProvider role="staff">
        <div />
      </GuidedTourProvider>
    )

    expect(mocks.guidedTour).toHaveBeenLastCalledWith(false)
  })
})
