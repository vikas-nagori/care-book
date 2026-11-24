import { redirect } from 'next/navigation'
import { accountContactLabel, fromAuthPhone } from '@/lib/auth/mobile-number'
import { mustChangePassword } from '@/lib/security/forced-password-change'
import { createClient } from '@/lib/supabase/server'
import { ChangePasswordForm } from './change-password-form'

export default async function ChangePasswordPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Not `!user.email`: since mobile-number sign-in an invitee may have no email, and sending a
  // signed-in user who must change their password to /login loops (middleware forces them back).
  if (!user) {
    redirect('/login')
  }

  // Only accounts still carrying a temporary password belong here; everyone else changes their
  // password from Settings.
  if (!mustChangePassword(user.app_metadata)) {
    redirect('/')
  }

  return (
    <ChangePasswordForm
      account={accountContactLabel({ email: user.email, mobile_number: fromAuthPhone(user.phone) })}
    />
  )
}
