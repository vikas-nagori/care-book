import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Patient } from '@/lib/supabase/types'

const mocks = vi.hoisted(() => ({ toast: vi.fn(), range: vi.fn() }))

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ order: () => ({ range: mocks.range }) }) }),
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
