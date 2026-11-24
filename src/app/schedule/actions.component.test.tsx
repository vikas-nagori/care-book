import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getCurrentProfile: vi.fn(), from: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentProfile: mocks.getCurrentProfile }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: mocks.from }) }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { updateAppointmentStatus } from './actions'

const APPOINTMENT_ID = '00000000-0000-4000-8000-000000000001'

/** A query builder whose every filter returns itself and which resolves to `result`. */
function builder(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = []
  const chain: Record<string, unknown> = {}
  for (const method of ['update', 'eq', 'select']) {
    chain[method] = (...args: unknown[]) => { calls.push([method, ...args]); return chain }
  }
  chain.then = (done: (value: unknown) => unknown) => done(result)
  return { chain, calls }
}

describe('updateAppointmentStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentProfile.mockResolvedValue({ id: 'staff-1', role: 'staff', status: 'active' })
  })

  it('reports success when the row was updated', async () => {
    const { chain, calls } = builder({ data: [{ id: APPOINTMENT_ID }], error: null })
    mocks.from.mockReturnValue(chain)
    await expect(updateAppointmentStatus({ appointmentId: APPOINTMENT_ID, status: 'completed' })).resolves.toEqual({ success: true })
    expect(calls).toContainEqual(['select', 'id'])
    expect(mocks.revalidatePath).toHaveBeenCalled()
  })

  it('does not report success when the appointment was deleted meanwhile (G-3)', async () => {
    mocks.from.mockReturnValue(builder({ data: [], error: null }).chain)
    const result = await updateAppointmentStatus({ appointmentId: APPOINTMENT_ID, status: 'completed' })
    expect(result).toMatchObject({ success: false, errorCode: 'APPOINTMENT_NOT_FOUND' })
    expect(result.success ? '' : result.message).toMatch(/no longer exists/)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
