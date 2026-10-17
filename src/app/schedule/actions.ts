'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { createClient } from '@/lib/supabase/server'

// --- Types ---

export type { NewPatientInput, CreateAppointmentInput, CreateAppointmentResult } from '@/lib/appointments/booking-contract'

export type UpdateAppointmentInput = {
  appointmentId: string
  patientId: string
  date: string
  time: string
  durationMinutes: number
  type: string
  status: string
  fee: number | null
  assignedTo?: string | null
  externalStaffId?: string | null
  notes: string | null
}

export type UpdateAppointmentResult =
  | { success: true }
  | { success: false; errorCode: string; message: string }

export type UpdateAppointmentStatusInput = {
  appointmentId: string
  status: string
}

export type UpdateAppointmentStatusResult =
  | { success: true }
  | { success: false; errorCode: string; message: string }

export type DeleteAppointmentResult =
  | { success: true }
  | { success: false; errorCode: string; message: string }

export type SaveSessionNoteInput = {
  appointmentId: string
  noteId?: string | null
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  exercises_prescribed: string | null
}

export type SaveSessionNoteResult =
  | { success: true }
  | { success: false; errorCode: string; message: string }

// --- Helpers ---

async function requireStaffOrAdmin() {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'staff'].includes(profile.role)) {
    return null
  }
  return profile
}

function revalidateScheduleViews(patientId?: string) {
  revalidatePath('/schedule')
  revalidatePath('/')
  revalidatePath('/billing')
  if (patientId) revalidatePath(`/patients/${patientId}`)
}

// --- Actions ---

export async function updateAppointment(input: UpdateAppointmentInput): Promise<UpdateAppointmentResult> {
  try {
    const profile = await requireStaffOrAdmin()
    if (!profile) {
      return { success: false, errorCode: 'SCHEDULE_UNAUTHORIZED', message: 'You are not allowed to manage appointments.' }
    }

    if (!input.appointmentId || !input.date || !input.time) {
      return { success: false, errorCode: 'SCHEDULE_MISSING_FIELDS', message: 'Appointment ID, date, and time are required.' }
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from('appointments')
      .update({
        patient_id: input.patientId,
        date: input.date,
        time: input.time,
        duration_minutes: input.durationMinutes || 45,
        type: input.type,
        status: input.status,
        fee: input.fee,
        assigned_to: input.assignedTo || null,
        external_staff_id: input.externalStaffId || null,
        notes: input.notes || null,
      })
      .eq('id', input.appointmentId)

    if (error) {
      logger.error('schedule/updateAppointment', error, { appointmentId: input.appointmentId })
      return { success: false, errorCode: 'APPOINTMENT_UPDATE_FAILED', message: error.message }
    }

    revalidateScheduleViews()
    return { success: true }
  } catch (error) {
    logger.error('schedule/updateAppointment/unexpected', error)
    return { success: false, errorCode: 'APPOINTMENT_UPDATE_FAILED', message: 'Unable to update appointment right now.' }
  }
}

export async function updateAppointmentStatus(input: UpdateAppointmentStatusInput): Promise<UpdateAppointmentStatusResult> {
  try {
    const profile = await requireStaffOrAdmin()
    if (!profile) {
      return { success: false, errorCode: 'SCHEDULE_UNAUTHORIZED', message: 'You are not allowed to manage appointments.' }
    }

    if (!input.appointmentId || !input.status) {
      return { success: false, errorCode: 'SCHEDULE_MISSING_FIELDS', message: 'Appointment ID and status are required.' }
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from('appointments')
      .update({ status: input.status })
      .eq('id', input.appointmentId)

    if (error) {
      logger.error('schedule/updateAppointmentStatus', error, { appointmentId: input.appointmentId })
      return { success: false, errorCode: 'APPOINTMENT_STATUS_UPDATE_FAILED', message: error.message }
    }

    revalidateScheduleViews()
    return { success: true }
  } catch (error) {
    logger.error('schedule/updateAppointmentStatus/unexpected', error)
    return { success: false, errorCode: 'APPOINTMENT_STATUS_UPDATE_FAILED', message: 'Unable to update status right now.' }
  }
}

export async function deleteAppointment(appointmentId: string): Promise<DeleteAppointmentResult> {
  try {
    const profile = await requireStaffOrAdmin()
    if (!profile) {
      return { success: false, errorCode: 'SCHEDULE_UNAUTHORIZED', message: 'You are not allowed to delete appointments.' }
    }

    if (!appointmentId) {
      return { success: false, errorCode: 'SCHEDULE_MISSING_FIELDS', message: 'Appointment ID is required.' }
    }

    const supabase = await createClient()

    const { data: appt, error: fetchError } = await supabase
      .from('appointments')
      .select('status')
      .eq('id', appointmentId)
      .single()

    if (fetchError) {
      logger.error('schedule/deleteAppointment/fetch', fetchError, { appointmentId })
      return { success: false, errorCode: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found.' }
    }
    if (!appt) {
      return { success: false, errorCode: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found.' }
    }

    if (appt.status !== 'scheduled') {
      return { success: false, errorCode: 'APPOINTMENT_NOT_DELETABLE', message: 'Only scheduled appointments can be deleted.' }
    }

    const { error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', appointmentId)

    if (error) {
      logger.error('schedule/deleteAppointment', error, { appointmentId })
      return { success: false, errorCode: 'APPOINTMENT_DELETE_FAILED', message: error.message }
    }

    revalidateScheduleViews()
    return { success: true }
  } catch (error) {
    logger.error('schedule/deleteAppointment/unexpected', error)
    return { success: false, errorCode: 'APPOINTMENT_DELETE_FAILED', message: 'Unable to delete appointment right now.' }
  }
}

export async function saveSessionNote(input: SaveSessionNoteInput): Promise<SaveSessionNoteResult> {
  try {
    const profile = await requireStaffOrAdmin()
    if (!profile) {
      return { success: false, errorCode: 'SCHEDULE_UNAUTHORIZED', message: 'You are not allowed to manage session notes.' }
    }

    if (!input.appointmentId) {
      return { success: false, errorCode: 'SCHEDULE_MISSING_FIELDS', message: 'Appointment ID is required.' }
    }

    const supabase = await createClient()
    const noteData = {
      appointment_id: input.appointmentId,
      subjective: input.subjective || null,
      objective: input.objective || null,
      assessment: input.assessment || null,
      plan: input.plan || null,
      exercises_prescribed: input.exercises_prescribed || null,
    }

    let error
    if (input.noteId) {
      ({ error } = await supabase.from('session_notes').update(noteData).eq('id', input.noteId))
    } else {
      ({ error } = await supabase.from('session_notes').insert(noteData))
    }

    if (error) {
      logger.error('schedule/saveSessionNote', error, { appointmentId: input.appointmentId, noteId: input.noteId })
      return { success: false, errorCode: 'SESSION_NOTE_SAVE_FAILED', message: error.message }
    }

    revalidatePath('/schedule')
    return { success: true }
  } catch (error) {
    logger.error('schedule/saveSessionNote/unexpected', error)
    return { success: false, errorCode: 'SESSION_NOTE_SAVE_FAILED', message: 'Unable to save session notes right now.' }
  }
}
