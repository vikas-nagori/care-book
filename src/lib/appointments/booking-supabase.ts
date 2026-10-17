import type { SupabaseClient } from '@supabase/supabase-js'
import type { BookingStore } from './booking-service'

const APPOINTMENT_FIELDS = 'id,clinic_id,created_by,patient_id,date,time,duration_minutes,appointment_type_id,status,fee,assigned_to,external_staff_id,notes'
const PATIENT_FIELDS = 'id,clinic_id,name,phone,email,dob,gender,address,medical_history,notes,referral_source,referred_by_doctor_id,referred_by_patient_id,referral_other'

/** Cookie-authenticated client retains RLS; explicit clinic filters add a second scope check. */
export function createBookingStore(supabase: SupabaseClient, clinicId: string): BookingStore {
  return {
    async getAppointmentType(id) {
      return await supabase.from('appointment_types').select('is_shared,session_rate').eq('clinic_id', clinicId).eq('id', id).maybeSingle()
    },
    async findAppointments(ids) {
      return await supabase.from('appointments').select(APPOINTMENT_FIELDS).eq('clinic_id', clinicId).in('id', ids)
    },
    async getPatient(id) {
      return await supabase.from('patients').select(PATIENT_FIELDS).eq('clinic_id', clinicId).eq('id', id).maybeSingle()
    },
    async insertPatient(row) {
      return await supabase.from('patients').insert(row).select('id').single()
    },
    async findConflicts(patientId, time, dates) {
      return await supabase.from('appointments').select('id,date').eq('clinic_id', clinicId).eq('patient_id', patientId).eq('time', time).in('date', dates)
    },
    async insertAppointments(rows) {
      return await supabase.from('appointments').insert(rows).select('id')
    },
  }
}
