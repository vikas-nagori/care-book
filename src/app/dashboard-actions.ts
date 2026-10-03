'use server'

import { getCurrentProfile } from '@/lib/auth'
import { evaluateRoleAccess } from '@/lib/auth-access'
import {
  loadDashboardAppointmentOptions,
  type AppointmentOptionsDataClient,
  type DashboardAppointmentOptionsResult,
} from '@/lib/dashboard/appointment-options'
import { logger } from '@/lib/logger'
import { createClient } from '@/lib/supabase/server'

export async function getDashboardAppointmentOptions(): Promise<DashboardAppointmentOptionsResult> {
  return loadDashboardAppointmentOptions({
    getCurrentProfile,
    createClient: async () => (await createClient()) as unknown as AppointmentOptionsDataClient,
    logError: logger.error,
  })
}

export async function getDashboardReminderPatients(): Promise<
  { ok: true; patients: { id: string; name: string }[] } | { ok: false }
> {
  const profile = await getCurrentProfile()
  if (evaluateRoleAccess(profile, ['admin', 'staff']) !== 'authorized') return { ok: false }
  const supabase = await createClient()
  const patients: { id: string; name: string }[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('patients').select('id, name')
      .order('name').order('id').range(offset, offset + 499)
    if (error) { logger.error('Dashboard/reminderPatients', error); return { ok: false } }
    patients.push(...(data ?? []))
    if (!data || data.length < 500) return { ok: true, patients }
  }
}
