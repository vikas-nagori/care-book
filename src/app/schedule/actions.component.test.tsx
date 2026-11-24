import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getCurrentProfile: vi.fn(), from: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentProfile: mocks.getCurrentProfile }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: mocks.from }) }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { saveSessionNote, updateAppointmentStatus } from './actions'

const APPOINTMENT_ID = '00000000-0000-4000-8000-000000000001'

/** A query builder whose every filter returns itself and which resolves to `result`. */
function builder(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = []
  const chain: Record<string, unknown> = {}
  for (const method of ['update', 'insert', 'eq', 'select', 'order', 'limit']) {
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

describe('saveSessionNote (G-4: one note per appointment)', () => {
  const note = { appointmentId: APPOINTMENT_ID, subjective: 'Better today', objective: null, assessment: null, plan: null, exercises_prescribed: null }

  /** Each `from('session_notes')` call gets the next scripted result; returns every call made. */
  function script(...results: { data: unknown; error: unknown }[]) {
    const queries: unknown[][][] = []
    mocks.from.mockImplementation(() => {
      const { chain, calls } = builder(results.shift() ?? { data: null, error: { message: 'unexpected query' } })
      queries.push(calls)
      return chain
    })
    return queries
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentProfile.mockResolvedValue({ id: 'staff-1', role: 'staff', status: 'active' })
  })

  it('inserts the first note of an appointment', async () => {
    const queries = script({ data: [], error: null }, { data: null, error: null })
    await expect(saveSessionNote({ ...note, noteId: null })).resolves.toEqual({ success: true })
    expect(queries[1][0]).toEqual(['insert', expect.objectContaining({ appointment_id: APPOINTMENT_ID, subjective: 'Better today' })])
  })

  it('a re-save without a noteId (lost reply, double tap) updates the existing note instead of inserting', async () => {
    const queries = script({ data: [{ id: 'note-1' }], error: null }, { data: [{ id: 'note-1' }], error: null })
    await expect(saveSessionNote({ ...note, noteId: null })).resolves.toEqual({ success: true })
    expect(queries[0]).toContainEqual(['eq', 'appointment_id', APPOINTMENT_ID])
    expect(queries[0]).toContainEqual(['limit', 1])
    expect(queries[1][0]).toEqual(['update', expect.objectContaining({ subjective: 'Better today' })])
    expect(queries[1]).toContainEqual(['eq', 'id', 'note-1'])
    expect(queries.flat().some(([method]) => method === 'insert')).toBe(false)
  })

  it('a concurrent save that wins the unique index turns the loser into an update', async () => {
    const queries = script(
      { data: [], error: null },
      { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "session_notes_one_per_appointment"' } },
      { data: null, error: null },
    )
    await expect(saveSessionNote({ ...note, noteId: null })).resolves.toEqual({ success: true })
    expect(queries[2][0]).toEqual(['update', expect.objectContaining({ subjective: 'Better today' })])
    expect(queries[2]).toContainEqual(['eq', 'appointment_id', APPOINTMENT_ID])
  })

  it('a note deleted meanwhile is saved again rather than reported as updated', async () => {
    const queries = script({ data: [], error: null }, { data: null, error: null })
    await expect(saveSessionNote({ ...note, noteId: 'gone-note' })).resolves.toEqual({ success: true })
    expect(queries[0]).toContainEqual(['eq', 'id', 'gone-note'])
    expect(queries[1][0]).toEqual(['insert', expect.objectContaining({ appointment_id: APPOINTMENT_ID })])
  })
})
