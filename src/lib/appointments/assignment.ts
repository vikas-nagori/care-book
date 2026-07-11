export type AppointmentAssignmentInput = {
  // Shared types (e.g. clinic visits) carry no assignee; restricted types do.
  isShared: boolean
  assignedTo?: string | null
  externalStaffId?: string | null
}

export type NormalizedAppointmentAssignment = {
  assigned_to: string | null
  external_staff_id: string | null
}

export type ParsedStaffAssignment = {
  assignedTo: string | null
  externalStaffId: string | null
}

function isAssignableAppointment(isShared: boolean) {
  return !isShared
}

function cleanId(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed || null
}

export function parseStaffAssignmentValue(value?: string | null): ParsedStaffAssignment {
  const cleaned = cleanId(value)
  if (!cleaned) {
    return { assignedTo: null, externalStaffId: null }
  }

  const [kind, ...rest] = cleaned.split(':')
  const id = cleanId(rest.join(':'))

  if (!id) {
    return { assignedTo: null, externalStaffId: null }
  }

  if (kind === 'internal') {
    return { assignedTo: id, externalStaffId: null }
  }

  if (kind === 'external') {
    return { assignedTo: null, externalStaffId: id }
  }

  return { assignedTo: null, externalStaffId: null }
}

export function normalizeAppointmentAssignment({
  isShared,
  assignedTo,
  externalStaffId,
}: AppointmentAssignmentInput): NormalizedAppointmentAssignment {
  if (!isAssignableAppointment(isShared)) {
    return {
      assigned_to: null,
      external_staff_id: null,
    }
  }

  const external_staff_id = cleanId(externalStaffId)
  if (external_staff_id) {
    return {
      assigned_to: null,
      external_staff_id,
    }
  }

  return {
    assigned_to: cleanId(assignedTo),
    external_staff_id: null,
  }
}
