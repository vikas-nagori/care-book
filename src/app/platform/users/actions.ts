'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminUser } from '@/lib/platform/server'
import { isPlatformAdminEmail } from '@/lib/platform/access'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { BAN_DURATION, UNBAN_DURATION, shouldUnbanOnUserUnblock } from '@/lib/platform/block'
import type {
  ClinicStatus,
  ManageUserBlockInput,
  ManageUserBlockResult,
} from '@/lib/supabase/types'

async function setBan(
  adminSupabase: ReturnType<typeof createAdminClient>,
  userId: string,
  banDuration: string
): Promise<void> {
  const { error } = await adminSupabase.auth.admin.updateUserById(userId, {
    ban_duration: banDuration,
  })
  if (error) {
    logger.error('platform/users/setBan', error, { userId, banDuration })
  }
}

export async function blockUser(input: ManageUserBlockInput): Promise<ManageUserBlockResult> {
  try {
    await requirePlatformAdminUser()
    if (!input.userId) {
      return { success: false, errorCode: 'USER_ID_REQUIRED', message: 'Choose a user.' }
    }

    const adminSupabase = createAdminClient()
    const { data: target, error: lookupError } = await adminSupabase
      .from('profiles')
      .select('id, email')
      .eq('id', input.userId)
      .maybeSingle()

    if (lookupError || !target) {
      logger.error('platform/blockUser/lookup', lookupError, input)
      return {
        success: false,
        errorCode: lookupError?.code ?? 'USER_NOT_FOUND',
        message: 'User was not found.',
      }
    }

    if (isPlatformAdminEmail(target.email)) {
      return {
        success: false,
        errorCode: 'CANNOT_BLOCK_SUPERADMIN',
        message: 'Superadmin accounts cannot be blocked.',
      }
    }

    const { error } = await adminSupabase
      .from('profiles')
      .update({ status: 'blocked', updated_at: new Date().toISOString() })
      .eq('id', input.userId)

    if (error) {
      logger.error('platform/blockUser/update', error, input)
      return { success: false, errorCode: error.code ?? 'USER_BLOCK_FAILED', message: error.message }
    }

    await setBan(adminSupabase, input.userId, BAN_DURATION)

    revalidatePath('/platform/users')
    return { success: true, status: 'blocked' }
  } catch (error) {
    logger.error('platform/blockUser/unexpected', error, input)
    return { success: false, errorCode: 'USER_BLOCK_FAILED', message: 'Unable to block this user right now.' }
  }
}

export async function unblockUser(input: ManageUserBlockInput): Promise<ManageUserBlockResult> {
  try {
    await requirePlatformAdminUser()
    if (!input.userId) {
      return { success: false, errorCode: 'USER_ID_REQUIRED', message: 'Choose a user.' }
    }

    const adminSupabase = createAdminClient()
    const { data: target, error: lookupError } = await adminSupabase
      .from('profiles')
      .select('id, clinic_id, clinic:clinics(status)')
      .eq('id', input.userId)
      .maybeSingle()

    if (lookupError || !target) {
      logger.error('platform/unblockUser/lookup', lookupError, input)
      return {
        success: false,
        errorCode: lookupError?.code ?? 'USER_NOT_FOUND',
        message: 'User was not found.',
      }
    }

    const { error } = await adminSupabase
      .from('profiles')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', input.userId)

    if (error) {
      logger.error('platform/unblockUser/update', error, input)
      return { success: false, errorCode: error.code ?? 'USER_UNBLOCK_FAILED', message: error.message }
    }

    // Embedded one-to-one relation may come back as an object or a single-element array.
    const clinic = Array.isArray(target.clinic) ? target.clinic[0] : target.clinic
    const clinicStatus: ClinicStatus | null = clinic?.status ?? null

    if (shouldUnbanOnUserUnblock(clinicStatus)) {
      await setBan(adminSupabase, input.userId, UNBAN_DURATION)
    }

    revalidatePath('/platform/users')
    return { success: true, status: 'active' }
  } catch (error) {
    logger.error('platform/unblockUser/unexpected', error, input)
    return { success: false, errorCode: 'USER_UNBLOCK_FAILED', message: 'Unable to unblock this user right now.' }
  }
}
