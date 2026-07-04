'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminUser } from '@/lib/platform/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { BAN_DURATION, UNBAN_DURATION, shouldUnbanOnClinicUnblock } from '@/lib/platform/block'
import type {
  ManageClinicBlockInput,
  ManageClinicBlockResult,
  ProfileStatus,
} from '@/lib/supabase/types'

type ClinicMember = { id: string; status: ProfileStatus }

async function loadClinicMembers(
  adminSupabase: ReturnType<typeof createAdminClient>,
  clinicId: string
): Promise<ClinicMember[]> {
  const { data, error } = await adminSupabase
    .from('profiles')
    .select('id, status')
    .eq('clinic_id', clinicId)

  if (error) {
    logger.error('platform/loadClinicMembers', error, { clinicId })
    return []
  }

  return (data ?? []) as ClinicMember[]
}

async function setBan(
  adminSupabase: ReturnType<typeof createAdminClient>,
  userId: string,
  banDuration: string
): Promise<void> {
  const { error } = await adminSupabase.auth.admin.updateUserById(userId, {
    ban_duration: banDuration,
  })
  if (error) {
    logger.error('platform/setBan', error, { userId, banDuration })
  }
}

export async function blockClinic(
  input: ManageClinicBlockInput
): Promise<ManageClinicBlockResult> {
  try {
    await requirePlatformAdminUser()
    if (!input.clinicId) {
      return { success: false, errorCode: 'CLINIC_ID_REQUIRED', message: 'Choose a clinic.' }
    }

    const adminSupabase = createAdminClient()
    const { data: clinic, error } = await adminSupabase
      .from('clinics')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('id', input.clinicId)
      .select('id')
      .maybeSingle()

    if (error || !clinic) {
      logger.error('platform/blockClinic/update', error, input)
      return {
        success: false,
        errorCode: error?.code ?? 'CLINIC_BLOCK_FAILED',
        message: error?.message ?? 'Clinic was not found.',
      }
    }

    const members = await loadClinicMembers(adminSupabase, input.clinicId)
    await Promise.all(members.map((member) => setBan(adminSupabase, member.id, BAN_DURATION)))

    revalidatePath('/platform/clinics')
    revalidatePath('/platform/users')
    return { success: true, status: 'inactive' }
  } catch (error) {
    logger.error('platform/blockClinic/unexpected', error, input)
    return { success: false, errorCode: 'CLINIC_BLOCK_FAILED', message: 'Unable to block this clinic right now.' }
  }
}

export async function unblockClinic(
  input: ManageClinicBlockInput
): Promise<ManageClinicBlockResult> {
  try {
    await requirePlatformAdminUser()
    if (!input.clinicId) {
      return { success: false, errorCode: 'CLINIC_ID_REQUIRED', message: 'Choose a clinic.' }
    }

    const adminSupabase = createAdminClient()
    const { data: clinic, error } = await adminSupabase
      .from('clinics')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', input.clinicId)
      .select('id')
      .maybeSingle()

    if (error || !clinic) {
      logger.error('platform/unblockClinic/update', error, input)
      return {
        success: false,
        errorCode: error?.code ?? 'CLINIC_UNBLOCK_FAILED',
        message: error?.message ?? 'Clinic was not found.',
      }
    }

    // Re-activate only members who are not individually blocked.
    const members = await loadClinicMembers(adminSupabase, input.clinicId)
    await Promise.all(
      members
        .filter((member) => shouldUnbanOnClinicUnblock(member.status))
        .map((member) => setBan(adminSupabase, member.id, UNBAN_DURATION))
    )

    revalidatePath('/platform/clinics')
    revalidatePath('/platform/users')
    return { success: true, status: 'active' }
  } catch (error) {
    logger.error('platform/unblockClinic/unexpected', error, input)
    return { success: false, errorCode: 'CLINIC_UNBLOCK_FAILED', message: 'Unable to unblock this clinic right now.' }
  }
}
