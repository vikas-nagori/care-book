import type { SupabaseClient } from '@supabase/supabase-js'

type LocalActionLink = {
  actionLink: string
  authUserId: string
  hashedToken: string
}

type LinkInput = {
  email: string
  redirectTo: string
}

type InviteLinkInput = LinkInput & {
  data?: Record<string, unknown>
}

function assertLoopbackUrl(value: string, label: string): void {
  let hostname: string
  try {
    hostname = new URL(value).hostname.toLowerCase()
  } catch {
    throw new Error(`${label} is not a valid URL: ${value}`)
  }
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error(`Refusing to generate an auth action link for a non-local ${label}: ${value}`)
  }
}

async function generateLocalAuthLink(
  db: SupabaseClient,
  input: LinkInput & { type: 'invite' | 'recovery'; data?: Record<string, unknown> },
): Promise<LocalActionLink> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required to generate an auth action link.')
  assertLoopbackUrl(supabaseUrl, 'Supabase URL')
  assertLoopbackUrl(input.redirectTo, 'auth redirect URL')

  const { data, error } = await db.auth.admin.generateLink({
    type: input.type,
    email: input.email.trim().toLowerCase(),
    options: {
      redirectTo: input.redirectTo,
      ...(input.type === 'invite' && input.data ? { data: input.data } : {}),
    },
  })
  if (error || !data.properties || !data.user) {
    throw new Error(`generate ${input.type} link: ${error?.message ?? 'link data was not returned'}`)
  }

  assertLoopbackUrl(data.properties.action_link, 'generated action link')
  const appActionLink = new URL(input.redirectTo)
  appActionLink.searchParams.set('token_hash', data.properties.hashed_token)
  appActionLink.searchParams.set('type', input.type)
  return {
    // GoTrue's raw link uses an implicit-session fragment in the local stack. Fragments never
    // reach Next's server callback, so drive the callback's supported token_hash contract.
    actionLink: appActionLink.toString(),
    authUserId: data.user.id,
    hashedToken: data.properties.hashed_token,
  }
}

export function generateLocalInviteLink(
  db: SupabaseClient,
  input: InviteLinkInput,
): Promise<LocalActionLink> {
  return generateLocalAuthLink(db, { ...input, type: 'invite' })
}

export function generateLocalRecoveryLink(
  db: SupabaseClient,
  input: LinkInput,
): Promise<LocalActionLink> {
  return generateLocalAuthLink(db, { ...input, type: 'recovery' })
}
