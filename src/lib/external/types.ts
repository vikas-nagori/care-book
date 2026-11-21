/** Safe contracts for the external coordination boundary. Never extend with clinical/billing fields. */
export type ExternalPatient = {
  id: string
  name: string
  phone: string | null
  dob: string | null
  gender: string | null
  email: string | null
  address: string | null
}

export type ExternalAppointment = {
  id: string
  patient_id: string
  patient_name: string
  appointment_type_id: string
  date: string
  time: string
  duration_minutes: number
  type: string
  status: 'scheduled' | 'completed' | 'cancelled'
}

export type ExternalAppointmentType = { id: string; name: string }

export type ExternalWorkspace = {
  patients: ExternalPatient[]
  appointments: ExternalAppointment[]
  appointment_types: ExternalAppointmentType[]
}

export type ExternalBookingRequest = {
  id: string
  patient_id: string
  appointment_type_id: string
  date: string
  time: string
  duration_minutes: number
}

/** Reschedule (status 'scheduled') or cancel (status 'cancelled', every other field unchanged). */
export type ExternalAppointmentUpdate = {
  id: string
  appointment_type_id: string
  date: string
  time: string
  duration_minutes: number
  status: 'scheduled' | 'cancelled'
}
