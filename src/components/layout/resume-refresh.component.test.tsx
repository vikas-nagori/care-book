import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), pathname: '/schedule' }))
vi.mock('next/navigation', () => ({
  useRouter: () => mocks,
  usePathname: () => mocks.pathname,
}))
vi.mock('@/lib/app-version', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app-version')>()),
  CLIENT_APP_VERSION: 'build-1',
}))

import { ResumeRefresh } from './resume-refresh'

const fetchMock = vi.fn<typeof fetch>()
const reload = vi.fn()
let online = true
let visibility: DocumentVisibilityState = 'visible'

function versionReply(version: string) {
  return new Response(JSON.stringify({ version }), { status: 200, headers: { 'content-type': 'application/json' } })
}

/** Background the app for `ms`, then bring it back. */
async function backgroundFor(ms: number) {
  visibility = 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
  vi.advanceTimersByTime(ms)
  visibility = 'visible'
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
}

async function goOnline() {
  online = true
  await act(async () => { window.dispatchEvent(new Event('online')) })
}

const requested = () => fetchMock.mock.calls.map(([url]) => String(url))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  online = true
  visibility = 'visible'
  mocks.pathname = '/schedule'
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } })
  fetchMock.mockResolvedValue(versionReply('build-1'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('ResumeRefresh', () => {
  it('reloads once when a newer build is live, without refreshing', async () => {
    fetchMock.mockResolvedValue(versionReply('build-2'))
    render(<ResumeRefresh />)
    await backgroundFor(120_000)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(requested()).toEqual(['/api/version'])
  })

  it('refreshes in place when the build is the same', async () => {
    render(<ResumeRefresh />)
    await backgroundFor(120_000)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
  })

  it('refreshes without reloading when the version check answers with an error', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }))
    render(<ResumeRefresh />)
    await backgroundFor(120_000)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
  })

  it('refreshes when only the version check is unreachable but the server answers', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url) === '/api/version') throw new TypeError('Failed to fetch')
      return new Response(null, { status: 200 })
    })
    render(<ResumeRefresh />)
    await backgroundFor(120_000)
    expect(requested()).toEqual(['/api/version', '/manifest.json'])
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
  })

  it('does nothing under a minute in the background, or on paused routes', async () => {
    render(<ResumeRefresh />)
    await backgroundFor(30_000)
    cleanup()
    mocks.pathname = '/login'
    render(<ResumeRefresh />)
    await backgroundFor(120_000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('G-21: resumed with no signal, it keeps the screen and catches up once back online', async () => {
    render(<ResumeRefresh />)
    online = false
    await backgroundFor(120_000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()

    await goOnline()
    expect(requested()).toEqual(['/api/version'])
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()

    // Caught up: another online event changes nothing.
    await goOnline()
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('G-21: back online onto a newer build, it reloads exactly once', async () => {
    render(<ResumeRefresh />)
    online = false
    await backgroundFor(120_000)
    fetchMock.mockResolvedValue(versionReply('build-2'))
    await goOnline()
    await goOnline()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('G-21: when nothing answers it does not refresh, and retries on the next return to the app', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<ResumeRefresh />)
    await backgroundFor(120_000)
    expect(requested()).toEqual(['/api/version', '/manifest.json'])
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()

    // Signal is back; a short switch away is enough to retry the pending catch-up.
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(versionReply('build-1'))
    await backgroundFor(5_000)
    expect(requested()).toEqual(['/api/version'])
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})
