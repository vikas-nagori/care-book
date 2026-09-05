import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ profile: vi.fn(), client: vi.fn(), refresh: vi.fn(), log: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentProfile: mocks.profile }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.refresh }))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.log } }))
import { createReminder, updateReminder, setReminderStatus, deleteReminder } from './reminder-actions'

const id = '11111111-1111-4111-8111-111111111111'
const clinicId = '22222222-2222-4222-8222-222222222222'
let chain: Record<string, ReturnType<typeof vi.fn>>
let from: ReturnType<typeof vi.fn>
beforeEach(() => {
  mocks.profile.mockResolvedValue({ id, clinic_id: clinicId, role: 'staff', status: 'active' })
  chain = Object.fromEntries(['insert', 'update', 'delete', 'select', 'eq'].map(k => [k, vi.fn().mockImplementation(() => chain)]))
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id }, error: null })
  from = vi.fn().mockReturnValue(chain)
  mocks.client.mockResolvedValue({ from })
})

describe('reminder actions', () => {
  it('creates a reminder without inserting a patient and derives protected fields', async () => {
    expect(await createReminder({ title: ' Call back ', date: '2026-09-05', clinic_id: 'forged' })).toEqual({ success: true })
    expect(from).toHaveBeenCalledWith('reminders')
    expect(from).not.toHaveBeenCalledWith('patients')
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Call back', clinic_id: clinicId, created_by: id, status: 'pending' }))
    expect(mocks.refresh).toHaveBeenCalledWith('/schedule')
  })
  it('rejects missing title before querying', async () => {
    expect((await createReminder({ title: ' ', date: '2026-09-05' })).success).toBe(false)
    expect(from).not.toHaveBeenCalled()
  })
  it.each([null, { id, clinic_id: clinicId, role: 'staff', status: 'inactive' }, { id, clinic_id: clinicId, role: 'super_admin', status: 'active' }])('denies unauthorized profile %j', async profile => {
    mocks.profile.mockResolvedValue(profile)
    expect((await createReminder({ title: 'Call', date: '2026-09-05' })).success).toBe(false)
    expect(from).not.toHaveBeenCalled()
  })
  it('rejects an inaccessible linked patient', async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect((await createReminder({ title: 'Call', date: '2026-09-05', patientId: id })).success).toBe(false)
    expect(chain.eq).toHaveBeenCalledWith('clinic_id', clinicId)
    expect(chain.insert).not.toHaveBeenCalled()
  })
  it('does not report success for a missing reminder', async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect((await deleteReminder(id)).success).toBe(false)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
  it('returns safe errors for database failures', async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: { message: 'private database info' } })
    const result = await setReminderStatus(id, 'completed')
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).not.toContain('private database info')
  })
  it('edits whitelisted fields and filters to the current clinic', async () => {
    expect((await updateReminder(id, { title: 'Move', date: '2026-09-20', status: 'completed', created_by: 'forged' })).success).toBe(true)
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ title: 'Move', date: '2026-09-20' }))
    expect(chain.update.mock.calls[0][0]).not.toHaveProperty('status')
    expect(chain.update.mock.calls[0][0]).not.toHaveProperty('created_by')
    expect(chain.eq).toHaveBeenCalledWith('clinic_id', clinicId)
  })
  it('rejects invalid ids and status', async () => {
    expect((await deleteReminder('bad')).success).toBe(false)
    expect((await setReminderStatus(id, 'bad')).success).toBe(false)
    expect(from).not.toHaveBeenCalled()
  })
})
