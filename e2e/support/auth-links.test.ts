import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLocalInviteLink, generateLocalRecoveryLink } from './auth-links.ts'

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
})

function linkClient(
  calls: Record<string, unknown>[],
  actionLink = 'http://127.0.0.1:54321/auth/v1/verify?token=hashed-link&type=link',
): SupabaseClient {
  return {
    auth: {
      admin: {
        async generateLink(input: Record<string, unknown>) {
          calls.push(input)
          const type = String(input.type)
          return {
            data: {
              properties: {
                action_link: actionLink.replace('hashed-link', `hashed-${type}`).replace('type=link', `type=${type}`),
                email_otp: '123456',
                hashed_token: `hashed-${type}`,
                redirect_to: String((input.options as { redirectTo: string }).redirectTo),
                verification_type: type,
              },
              user: { id: `${type}-auth-id`, email: input.email },
            },
            error: null,
          }
        },
      },
    },
  } as unknown as SupabaseClient
}

test('local invite and recovery helpers generate callback action links without email scraping', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
  const calls: Record<string, unknown>[] = []
  const db = linkClient(calls)

  const invite = await generateLocalInviteLink(db, {
    email: 'invite@carebook.test',
    redirectTo: 'http://localhost:3000/auth/callback?next=%2Fauth%2Fcomplete-invite',
    data: { role: 'staff', clinic_id: 'clinic-id' },
  })
  const recovery = await generateLocalRecoveryLink(db, {
    email: 'recover@carebook.test',
    redirectTo: 'http://localhost:3000/auth/callback?next=%2Fauth%2Fupdate-password',
  })

  assert.equal(invite.actionLink.includes('type=invite'), true)
  assert.equal(new URL(invite.actionLink).pathname, '/auth/callback')
  assert.equal(new URL(invite.actionLink).searchParams.get('token_hash'), 'hashed-invite')
  assert.equal(invite.authUserId, 'invite-auth-id')
  assert.equal(recovery.actionLink.includes('type=recovery'), true)
  assert.equal(new URL(recovery.actionLink).pathname, '/auth/callback')
  assert.equal(new URL(recovery.actionLink).searchParams.get('token_hash'), 'hashed-recovery')
  assert.equal(recovery.authUserId, 'recovery-auth-id')
  assert.deepEqual(calls.map((call) => call.type), ['invite', 'recovery'])
})

test('local auth link helpers reject a hosted Supabase target before generating a link', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  const calls: Record<string, unknown>[] = []

  await assert.rejects(
    generateLocalRecoveryLink(linkClient(calls), {
      email: 'recover@carebook.test',
      redirectTo: 'http://localhost:3000/auth/callback?next=%2Fauth%2Fupdate-password',
    }),
    /refusing to generate an auth action link for a non-local supabase url/i,
  )
  assert.deepEqual(calls, [])
})

test('hosted generated-link errors expose only the origin, never its secret query', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
  const calls: Record<string, unknown>[] = []
  const secret = 'do-not-leak-this-token'

  await assert.rejects(
    generateLocalRecoveryLink(
      linkClient(calls, `https://example.supabase.co/auth/v1/verify?token=${secret}&type=recovery`),
      {
        email: 'recover@carebook.test',
        redirectTo: 'http://localhost:3000/auth/callback?next=%2Fauth%2Fupdate-password',
      },
    ),
    (error: unknown) => {
      assert.equal(error instanceof Error, true)
      const message = (error as Error).message
      assert.match(message, /https:\/\/example\.supabase\.co/)
      assert.equal(message.includes(secret), false)
      assert.equal(message.includes('/auth/v1/verify'), false)
      return true
    },
  )
})

test('local auth link helpers reject non-HTTP protocols without exposing query values', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
  const calls: Record<string, unknown>[] = []
  const secret = 'private-callback-value'

  await assert.rejects(
    generateLocalRecoveryLink(linkClient(calls), {
      email: 'recover@carebook.test',
      redirectTo: `ftp://localhost/auth/callback?secret=${secret}`,
    }),
    (error: unknown) => {
      assert.equal(error instanceof Error, true)
      const message = (error as Error).message
      assert.match(message, /http or https/i)
      assert.equal(message.includes(secret), false)
      return true
    },
  )
  assert.deepEqual(calls, [])
})
