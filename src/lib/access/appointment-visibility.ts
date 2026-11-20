import type { Appointment, Profile } from '../supabase/types'

type AppointmentVisibilityProfile = Pick<Profile, 'id' | 'role'> | null
type AppointmentVisibilitySubject = Pick<Appointment, 'type_is_shared' | 'created_by' | 'assigned_to' | 'external_profile_id'>

const NO_APPOINTMENT_VISIBILITY_FILTER = 'id.eq.00000000-0000-0000-0000-000000000000'

export function canViewAppointmentForProfile(
  appointment: AppointmentVisibilitySubject,
  profile: AppointmentVisibilityProfile,
) {
  if (!profile) return false
  if (profile.role === 'admin') return true
  // External accounts use safe RPC projections, never full clinical appointment records.
  if (profile.role !== 'staff' || appointment.external_profile_id) return false
  if (appointment.type_is_shared) return true

  return appointment.created_by === profile.id || appointment.assigned_to === profile.id
}

export function getAppointmentVisibilityFilter(profile: AppointmentVisibilityProfile) {
  if (!profile) return NO_APPOINTMENT_VISIBILITY_FILTER
  if (profile.role === 'admin') return null
  if (profile.role !== 'staff') return NO_APPOINTMENT_VISIBILITY_FILTER

  return `and(external_profile_id.is.null,or(type_is_shared.eq.true,created_by.eq.${profile.id},assigned_to.eq.${profile.id}))`
}
