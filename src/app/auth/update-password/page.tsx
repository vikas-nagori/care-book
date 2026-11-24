import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  PASSWORD_RECOVERY_COOKIE,
  resolveUpdatePasswordAccess,
  sessionIdFromAccessToken,
} from '@/lib/auth/password-recovery'
import { isPlatformAdminEmail } from '@/lib/platform/access'
import { createClient } from '@/lib/supabase/server'
import { isUserRole } from '@/lib/user-role'
import { UpdatePasswordForm } from './update-password-form'

export default async function UpdatePasswordPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?error=reset-link-invalid')
  }

  // Only the session a reset link just created may set a password here without the current one
  // (decision D4d). getUser() above has verified this same token, so reading its session id is safe.
  const cookieStore = await cookies()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const markedSessionId = cookieStore.get(PASSWORD_RECOVERY_COOKIE)?.value
  const currentSessionId = sessionIdFromAccessToken(session?.access_token)

  if (!markedSessionId || markedSessionId !== currentSessionId) {
    const isPlatformAdmin = isPlatformAdminEmail(user.email)
    const { data: profile } = isPlatformAdmin
      ? { data: null }
      : await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
    const access = resolveUpdatePasswordAccess({
      markedSessionId,
      currentSessionId,
      isPlatformAdmin,
      role: isUserRole(profile?.role) ? profile.role : null,
    })
    if (access !== 'allow') redirect(access)
  }

  return <UpdatePasswordForm email={user.email ?? ''} />
}
