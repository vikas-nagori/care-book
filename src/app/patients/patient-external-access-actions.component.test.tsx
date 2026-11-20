import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ profile: vi.fn(), client: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentProfile: mocks.profile }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

import { savePatientExternalAccess } from './actions'

const patientId = '11111111-1111-4111-8111-111111111111'
const profileId = 'AB222222-2222-4222-8222-222222222222'
const admin = { role: 'admin', status: 'active', clinic_id: 'clinic', clinic: { status: 'active' } }

describe('savePatientExternalAccess', () => {
  beforeEach(() => {
    mocks.profile.mockResolvedValue(admin)
    mocks.rpc.mockResolvedValue({ error: null })
    mocks.client.mockResolvedValue({ rpc: mocks.rpc })
  })

  it.each([
    null,
    { ...admin, role: 'staff' },
    { ...admin, role: 'external_staff' },
    { ...admin, status: 'blocked' },
    { ...admin, clinic: { status: 'inactive' } },
  ])('denies ineligible actors before opening a mutation client (%j)', async (profile) => {
    mocks.profile.mockResolvedValue(profile)
    expect(await savePatientExternalAccess(patientId, [profileId])).toMatchObject({ success: false })
    expect(mocks.client).not.toHaveBeenCalled()
  })

  it('replaces the list once with normalized values and supports revocation to zero accounts', async () => {
    expect(await savePatientExternalAccess(patientId, [profileId, profileId.toLowerCase()])).toEqual({ success: true })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('replace_patient_external_access', {
      p_patient_id: patientId, p_profile_ids: [profileId.toLowerCase()],
    })
    expect(mocks.revalidate).toHaveBeenCalledWith(`/patients/${patientId}`)
    expect(await savePatientExternalAccess(patientId, [])).toEqual({ success: true })
    expect(mocks.rpc).toHaveBeenLastCalledWith('replace_patient_external_access', { p_patient_id: patientId, p_profile_ids: [] })
  })

  it('returns a safe error when the RPC rejects the new grants', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { code: '22023', message: 'private database details' } })
    expect(await savePatientExternalAccess(patientId, [profileId])).toEqual({
      success: false, message: 'Choose active External Staff from this clinic.',
    })
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('confirms a committed save if view revalidation fails', async () => {
    mocks.revalidate.mockImplementationOnce(() => { throw new Error('Cache unavailable') })
    expect(await savePatientExternalAccess(patientId, [profileId])).toEqual({ success: true })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
})
