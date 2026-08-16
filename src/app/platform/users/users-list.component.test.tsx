import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { PlatformUserSummary } from '@/lib/supabase/types'

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('./actions', () => ({
  blockUser: vi.fn(),
  sendPasswordReset: vi.fn(),
  unblockUser: vi.fn(),
}))

import { UsersList } from './users-list'

function makeUser(overrides: Partial<PlatformUserSummary> = {}): PlatformUserSummary {
  return {
    id: 'user-1',
    clinic_id: 'clinic-1',
    email: 'owner@example.com',
    role: 'admin',
    full_name: null,
    mobile_number: null,
    status: 'active',
    deleted_at: null,
    deleted_by: null,
    deletion_reason: null,
    created_at: '2026-08-16T12:52:14.000Z',
    updated_at: '2026-08-16T12:52:14.000Z',
    clinic_name: 'New Clinic',
    clinic_status: 'active',
    has_pending_invite: false,
    ...overrides,
  } as PlatformUserSummary
}

describe('UsersList', () => {
  afterEach(() => {
    cleanup()
  })

  it('marks a user whose invite has not been accepted yet', () => {
    render(
      <UsersList users={[makeUser({ has_pending_invite: true })]} superadminIds={[]} />
    )

    expect(screen.getByText('invite pending')).toBeTruthy()
  })

  it('does not mark a user who has accepted their invite', () => {
    render(<UsersList users={[makeUser()]} superadminIds={[]} />)

    expect(screen.queryByText('invite pending')).toBeNull()
  })

  it('shows the granted role alongside the pending badge rather than replacing it', () => {
    render(
      <UsersList
        users={[makeUser({ has_pending_invite: true, role: 'admin' })]}
        superadminIds={[]}
      />
    )

    expect(screen.getByText('admin')).toBeTruthy()
    expect(screen.getByText('invite pending')).toBeTruthy()
  })
})
