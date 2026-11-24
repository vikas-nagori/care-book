import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ClinicOnboardingRequest } from '@/lib/supabase/types'

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  reject: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('./actions', () => ({
  approveClinicOnboardingRequest: mocks.approve,
  rejectClinicOnboardingRequest: mocks.reject,
}))

import { ClinicRequestsList } from './clinic-requests-list'

function request(id: string, clinicName: string): ClinicOnboardingRequest {
  return {
    id,
    clinic_name: clinicName,
    clinic_phone: null,
    clinic_address: null,
    owner_full_name: 'Owner',
    owner_email: `${id}@example.com`,
    owner_mobile_number: '9876543210',
    status: 'pending',
  } as ClinicOnboardingRequest
}

describe('ClinicRequestsList (G-5)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it('keeps an in-flight Approve locked while another request is rejected', async () => {
    let finishApprove: (value: unknown) => void = () => {}
    mocks.approve.mockReturnValue(new Promise((resolve) => { finishApprove = resolve }))
    mocks.reject.mockResolvedValue({ success: true, request: { id: 'b' } })
    render(<ClinicRequestsList requests={[request('a', 'Clinic A'), request('b', 'Clinic B')]} />)

    const approveA = screen.getByRole('button', { name: 'Approve Clinic A' })
    const rejectA = screen.getByRole('button', { name: 'Reject Clinic A' })
    fireEvent.click(approveA)
    await waitFor(() => expect(approveA).toHaveProperty('disabled', true))

    fireEvent.click(screen.getByRole('button', { name: 'Reject Clinic B' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Request rejected' })))
    expect(approveA).toHaveProperty('disabled', true)
    expect(rejectA).toHaveProperty('disabled', true)

    // A second tap on the locked request sends nothing.
    fireEvent.click(approveA)
    expect(mocks.approve).toHaveBeenCalledTimes(1)

    await act(async () => finishApprove({ success: false, errorCode: 'x', message: 'nope' }))
    await waitFor(() => expect(approveA).toHaveProperty('disabled', false))
  })
})
