'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { isReminderId, validateReminderInput } from '@/lib/reminders/validation'

type Result = { success: true } | { success: false; message: string }
type Operation = 'create' | 'update' | 'status' | 'delete'

async function mutateReminder(operation: Operation, id?: string, input?: unknown): Promise<Result> {
  if (operation !== 'create' && !isReminderId(id)) return { success: false, message: 'This reminder is unavailable.' }
  const validated = operation === 'create' || operation === 'update' ? validateReminderInput(input) : null
  if (validated && !validated.success) return validated
  if (operation === 'status' && input !== 'pending' && input !== 'completed') {
    return { success: false, message: 'Choose a valid reminder status.' }
  }
  try {
    const profile = await getCurrentProfile()
    if (!profile?.clinic_id || profile.status !== 'active' || !['admin', 'staff'].includes(profile.role)) {
      return { success: false, message: 'Sign in with an active clinic account to manage reminders.' }
    }
    const supabase = await createClient()
    const fields = validated?.success ? validated.data : null
    if (fields?.patient_id) {
      const { data, error } = await supabase.from('patients').select('id')
        .eq('id', fields.patient_id).eq('clinic_id', profile.clinic_id).maybeSingle()
      if (error) logger.error('reminders/patient', error)
      if (error || !data) return { success: false, message: 'This patient is unavailable. Choose another patient or use name only.' }
    }
    const table = supabase.from('reminders')
    const query = operation === 'create'
      ? table.insert({ ...fields, clinic_id: profile.clinic_id, created_by: profile.id, status: 'pending' })
      : operation === 'delete'
        ? table.delete().eq('id', id!).eq('clinic_id', profile.clinic_id)
        : table.update(operation === 'status' ? { status: input } : fields!)
          .eq('id', id!).eq('clinic_id', profile.clinic_id)
    const { data, error } = await query.select('id').maybeSingle()
    if (error) {
      logger.error(`reminders/${operation}`, error)
      return { success: false, message: 'Could not save this change. Please try again.' }
    }
    if (!data) return { success: false, message: 'This reminder is unavailable. Refresh the calendar and try again.' }
    revalidatePath('/schedule')
    revalidatePath('/')
    return { success: true }
  } catch (error) {
    logger.error(`reminders/${operation}`, error)
    return { success: false, message: 'Could not save this change. Please try again.' }
  }
}

export async function createReminder(input: unknown): Promise<Result> {
  return mutateReminder('create', undefined, input)
}
export async function updateReminder(id: string, input: unknown): Promise<Result> {
  return mutateReminder('update', id, input)
}
export async function setReminderStatus(id: string, status: string): Promise<Result> {
  return mutateReminder('status', id, status)
}
export async function deleteReminder(id: string): Promise<Result> {
  return mutateReminder('delete', id)
}
