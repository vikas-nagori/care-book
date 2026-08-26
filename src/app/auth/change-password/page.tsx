import { redirect } from 'next/navigation'
import { mustChangePassword } from '@/lib/security/forced-password-change'
import { createClient } from '@/lib/supabase/server'
import { ChangePasswordForm } from './change-password-form'

export default async function ChangePasswordPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    redirect('/login')
  }

  // Only accounts still carrying a temporary password belong here; everyone else changes their
  // password from Settings.
  if (!mustChangePassword(user.app_metadata)) {
    redirect('/')
  }

  return <ChangePasswordForm email={user.email} />
}
