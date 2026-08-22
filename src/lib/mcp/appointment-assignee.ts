export type AssigneeInputs = {
  /** True when the appointment type is visible to the whole clinic. */
  typeIsShared: boolean
  /** Internal staff id resolved from an explicit name, if one was given. */
  explicitAssigneeId: string | null
  /** External staff id resolved from an explicit name, if one was given. */
  explicitExternalStaffId: string | null
  /** The profile id of whoever is making the booking. */
  bookingUserId: string
}

export type AssigneeResolution = {
  assignedTo: string | null
  externalStaffId: string | null
  /** True when nobody was named and the booking fell to the caller, so the caller can be told. */
  defaultedToBookingUser: boolean
}

/**
 * Decide who a new appointment belongs to.
 *
 * Whoever books is the treating clinician unless they name someone else — an unassigned booking is
 * invisible to the staff member expected to deliver it, because staff appointment visibility keys
 * off `assigned_to`. A shared appointment type is visible clinic-wide and carries no assignee by
 * design, so it stays unassigned no matter who books it.
 */
export function resolveAppointmentAssignee({
  typeIsShared,
  explicitAssigneeId,
  explicitExternalStaffId,
  bookingUserId,
}: AssigneeInputs): AssigneeResolution {
  if (typeIsShared) {
    return { assignedTo: null, externalStaffId: null, defaultedToBookingUser: false }
  }
  if (explicitExternalStaffId) {
    return { assignedTo: null, externalStaffId: explicitExternalStaffId, defaultedToBookingUser: false }
  }
  if (explicitAssigneeId) {
    return { assignedTo: explicitAssigneeId, externalStaffId: null, defaultedToBookingUser: false }
  }
  return { assignedTo: bookingUserId, externalStaffId: null, defaultedToBookingUser: true }
}
