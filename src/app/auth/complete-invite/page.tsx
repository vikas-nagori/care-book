import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeEmail } from '@/lib/onboarding/invite-helpers'
import { createClient } from '@/lib/supabase/server'
import { CompleteInviteForm } from './complete-invite-form'

export default async function CompleteInvitePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    redirect('/login?error=invite-required')
  }

  const adminSupabase = createAdminClient()
  const normalizedEmail = normalizeEmail(user.email)
  const { data: invite } = await adminSupabase
    .from('user_invites')
    .select('status')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (!invite || invite.status !== 'pending') {
    redirect('/login?error=invite-link-invalid')
  }

  return <CompleteInviteForm email={normalizedEmail} />
}
