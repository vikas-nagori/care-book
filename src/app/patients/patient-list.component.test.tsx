import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Patient } from '@/lib/supabase/types'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  range: vi.fn(),
  searchResult: vi.fn(),
  searchParams: new URLSearchParams(),
}))

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.searchParams }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        order: () => ({ range: mocks.range }),
        or: () => ({ order: () => ({ limit: () => ({ abortSignal: mocks.searchResult }) }) }),
      }),
    }),
  }),
}))

import { PatientList } from './patient-list'

const patient = (id: string, name: string) => ({ id, name, phone: null }) as unknown as Patient

describe('PatientList load more', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  // A dropped connection comes back from supabase-js as `error`, not a throw. The button must
  // come back and say what happened instead of silently doing nothing.
  it('reports a failed page load and re-enables the button', async () => {
    mocks.range.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch', status: 0 } })
    render(<PatientList initialPatients={[patient('p1', 'Asha')]} totalCount={5} pageSize={1} />)

    fireEvent.click(screen.getByRole('button', { name: 'Load more (4 remaining)' }))

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Couldn't load more patients",
        description: expect.stringMatching(/^Couldn't reach Care-Book/),
        variant: 'destructive',
      }))
    })
    expect((screen.getByRole('button', { name: 'Load more (4 remaining)' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('PatientList age', () => {
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('shows each patient age, from an entered age or a date of birth, on desktop and mobile rows', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-24T06:00:00Z'))
    const patients = [
      { id: 'p1', name: 'Entered Age', phone: '9000000001', gender: 'female', dob: null, age_years: 30, age_recorded_on: '2026-11-24' },
      { id: 'p2', name: 'Birth Date', phone: '9000000002', gender: null, dob: '1990-03-10', age_years: null, age_recorded_on: null },
      { id: 'p3', name: 'No Age', phone: '9000000003', gender: null, dob: null, age_years: null, age_recorded_on: null },
    ] as unknown as Patient[]
    render(<PatientList initialPatients={patients} totalCount={3} pageSize={50} />)

    expect(screen.getByText('female · 30 y')).toBeTruthy()
    expect(screen.getByText('36 y')).toBeTruthy()
    expect(screen.getByText('9000000001 · 30 y')).toBeTruthy()
    expect(screen.getByText('9000000002 · 36 y')).toBeTruthy()
    expect(screen.getAllByText('9000000003').length).toBe(2)
  })
})

describe('PatientList search kept in the URL (G-23)', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    mocks.searchParams = new URLSearchParams()
    window.history.replaceState(null, '', '/patients')
  })

  it('writes the search into the URL once typing settles, and drops it when cleared', async () => {
    window.history.replaceState(null, '', '/patients')
    mocks.searchResult.mockResolvedValue({ data: [patient('p9', 'Meera Iyer')], error: null })
    render(<PatientList initialPatients={[patient('p1', 'Asha')]} totalCount={1} pageSize={50} />)

    fireEvent.change(screen.getByLabelText('Search patients'), { target: { value: 'Meera I' } })
    expect(window.location.search).toBe('')
    await waitFor(() => expect(new URL(window.location.href).searchParams.get('q')).toBe('Meera I'))
    expect(window.location.pathname).toBe('/patients')
    await screen.findAllByText('Meera Iyer')

    fireEvent.change(screen.getByLabelText('Search patients'), { target: { value: '' } })
    await waitFor(() => expect(window.location.search).toBe(''))
  })

  it('starts from the search in the URL, so back from a patient shows the same results', async () => {
    mocks.searchParams = new URLSearchParams('q=Meera')
    window.history.replaceState(null, '', '/patients?q=Meera')
    mocks.searchResult.mockResolvedValue({ data: [patient('p9', 'Meera Iyer')], error: null })
    render(<PatientList initialPatients={[patient('p1', 'Asha')]} totalCount={1} pageSize={50} />)

    expect((screen.getByLabelText('Search patients') as HTMLInputElement).value).toBe('Meera')
    expect((await screen.findAllByText('Meera Iyer')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Asha')).toBeNull()
    expect(mocks.searchResult).toHaveBeenCalledOnce()
  })
})
