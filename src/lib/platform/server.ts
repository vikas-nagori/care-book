import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { shouldLogAuthError } from '@/lib/auth-error-classification'
import { isPlatformAdminEmail } from './access'

export type PlatformAdminUser = {
  id: string
  email: string
}

export async function getPlatformAdminUser(): Promise<PlatformAdminUser | null> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (shouldLogAuthError(error)) {
    logger.error('platform/getPlatformAdminUser/getUser', error)
  }

  if (!user?.id || !user.email || !isPlatformAdminEmail(user.email)) {
    return null
  }

  return {
    id: user.id,
    email: user.email,
  }
}

export async function requirePlatformAdminUser(): Promise<PlatformAdminUser> {
  const user = await getPlatformAdminUser()
  if (!user) redirect('/')
  return user
}
