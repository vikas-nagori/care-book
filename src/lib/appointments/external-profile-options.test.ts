import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadActiveExternalProfiles } from './external-profile-options.ts'

/** Answers each table with fixed rows, ignoring filters (the real ones run under RLS in prod). */
function fakeSupabase(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'in', 'order']) chain[method] = () => chain
      chain.range = async (from: number) => ({ data: from === 0 ? tables[table] ?? [] : [], error: null })
      return chain
    },
  } as unknown as SupabaseClient
}

// An External Staff invited but not yet signed in has a profile with no name and no email (the
// name is copied from the invite on acceptance). They are already eligible for patient access in
// the DB (private.eligible_external_profile), so the picker must list them, by name.
test('lists a pending invitee under the name on their invite, flagged as pending', async () => {
  const options = await loadActiveExternalProfiles(fakeSupabase({
    profiles: [
      { id: 'accepted', full_name: 'Ravi Kumar', email: null, mobile_number: '9000000001' },
      { id: 'pending', full_name: null, email: null, mobile_number: '9000000002' },
      { id: 'revoked', full_name: null, email: null, mobile_number: '9000000003' },
    ],
    user_invites: [
      { auth_user_id: 'pending', email: null, status: 'pending', full_name: 'Dr Test Invitee' },
      { auth_user_id: 'revoked', email: null, status: 'revoked', full_name: 'Gone' },
    ],
  }), 'clinic-1')

  assert.deepEqual(options, [
    { id: 'pending', full_name: 'Dr Test Invitee', email: null, mobile_number: '9000000002', invite_pending: true },
    { id: 'accepted', full_name: 'Ravi Kumar', email: null, mobile_number: '9000000001', invite_pending: false },
  ])
})
