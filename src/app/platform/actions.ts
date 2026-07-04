'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

export async function signOutFromPlatform(): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut()

  if (error) {
    logger.error('platform/signOutFromPlatform', error)
  }

  redirect('/login')
}
