'use server'

import { getCurrentProfile } from '@/lib/auth'
import { evaluateRoleAccess } from '@/lib/auth-access'
import type { ExternalAppointment } from '@/lib/external/types'
import { EXTERNAL_ACCESS_MESSAGE, parseExternalBookingRequest, projectExternalAppointment } from '@/lib/external/workspace'
import { logger } from '@/lib/logger'
import { createClient } from '@/lib/supabase/server'
import { CLINIC_TIME_ZONE, getZonedDate } from '@/lib/timezone'

type CreateExternalAppointmentResult =
  | { success: true; appointment: ExternalAppointment }
  | { success: false; message: string; accessDenied?: true }

export async function createExternalAppointment(input: unknown): Promise<CreateExternalAppointmentResult> {
  try {
    const profile = await getCurrentProfile()
    if (evaluateRoleAccess(profile, ['external_staff']) !== 'authorized') {
      return { success: false, accessDenied: true, message: EXTERNAL_ACCESS_MESSAGE }
    }

    const request = parseExternalBookingRequest(input)
    if (!request) return { success: false, message: 'Check the appointment details and try again.' }
    // Mirrors the database rule: a backdated booking would be auto-completed and billed.
    if (request.date < getZonedDate(new Date(), CLINIC_TIME_ZONE)) {
      return { success: false, message: 'Choose today or a later date.' }
    }

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('external_create_appointment', { p_request: request })
    if (error?.code === '42501') {
      return { success: false, accessDenied: true, message: EXTERNAL_ACCESS_MESSAGE }
    }
    if (error?.code === '23P01') {
      return { success: false, message: 'You already have an appointment for this patient at that time.' }
    }
    if (error?.code === '22023') {
      return { success: false, message: 'These appointment details could not be booked. Check your selections and try again.' }
    }

    const appointment = projectExternalAppointment(data)
    if (!error && appointment) return { success: true, appointment }
    logger.warn('external/createAppointment', 'Booking RPC failed.', { code: error?.code })
  } catch {
    logger.warn('external/createAppointment', 'Unable to complete booking request.')
  }

  return { success: false, message: 'Unable to book this appointment right now. Try again.' }
}
