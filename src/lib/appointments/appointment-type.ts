import type { Appointment, GlobalSettings } from '../supabase/types'

export type AppointmentType = Appointment['type']

export const APPOINTMENT_TYPES = ['clinic', 'home_visit', 'clinic_home_visit'] as const

export const APPOINTMENT_TYPE_LABEL: Record<AppointmentType, string> = {
  clinic: 'Clinic',
  home_visit: 'Home Visit',
  clinic_home_visit: 'Clinic Home Visit',
}

// Compact labels for badges / chips where space is tight.
export const APPOINTMENT_TYPE_SHORT_LABEL: Record<AppointmentType, string> = {
  clinic: 'Clinic',
  home_visit: 'Home',
  clinic_home_visit: 'C. Home',
}

// Both home-visit variants share restricted visibility and keep an assignee.
export function isHomeVisitType(type: AppointmentType): boolean {
  return type === 'home_visit' || type === 'clinic_home_visit'
}

// Default fee for a given appointment type, sourced from global settings.
export function feeForType(settings: GlobalSettings, type: AppointmentType): number {
  switch (type) {
    case 'home_visit':
      return settings.home_visit_fee
    case 'clinic_home_visit':
      return settings.clinic_home_visit_fee
    case 'clinic':
    default:
      return settings.clinic_fee
  }
}
