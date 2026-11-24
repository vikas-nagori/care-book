import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { Profile } from '@/lib/supabase/types'

import { UsersList } from './users-list'

const BASE: Profile = {
  id: 'profile-1',
  clinic_id: 'clinic-1',
  email: null,
  role: 'staff',
  full_name: 'Test Mobile User',
  mobile_number: '9876543210',
  status: 'active',
  deleted_at: null,
  deleted_by: null,
  deletion_reason: null,
  created_at: '2026-11-24T00:00:00.000Z',
  updated_at: '2026-11-24T00:00:00.000Z',
}

describe('UsersList (G-24)', () => {
  afterEach(cleanup)

  it('shows a mobile-only user by the formatted number on the desktop table, never raw digits or a dash', () => {
    render(<UsersList profiles={[BASE]} />)
    const row = screen.getByRole('row', { name: /Test Mobile User/ })
    expect(within(row).getByText('98765 43210')).toBeTruthy()
    expect(within(row).getByText('Not added yet')).toBeTruthy()
    expect(row.textContent).not.toContain('9876543210')
    expect(row.textContent).not.toContain('—')
  })

  it('shows the formatted number once on the phone sheet', () => {
    render(<UsersList profiles={[BASE]} variant="sheet" />)
    expect(screen.getAllByText('98765 43210')).toHaveLength(1)
    expect(screen.queryByText('9876543210')).toBeNull()
  })

  it('keeps the email and adds the formatted number when a user has both', () => {
    const withEmail = { ...BASE, email: 'user@example.com' }
    render(<UsersList profiles={[withEmail]} variant="sheet" />)
    expect(screen.getByText('user@example.com')).toBeTruthy()
    expect(screen.getByText('98765 43210')).toBeTruthy()
  })
})
