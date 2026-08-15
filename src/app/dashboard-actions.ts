'use server'

import { getCurrentProfile } from '@/lib/auth'
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
