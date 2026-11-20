export type ExternalProfileOption = {
  id: string
  full_name: string | null
  email: string
}

export type AppointmentAssignmentInput = {
  isShared: boolean
  assignedTo?: string | null
  externalStaffId?: string | null
  externalProfileId?: string | null
}

export type NormalizedAppointmentAssignment = {
  assigned_to: string | null
  external_staff_id: string | null
  external_profile_id: string | null
}

type ParsedStaffAssignment = {
  assignedTo: string | null
  externalStaffId: string | null
  externalProfileId: string | null
}

function cleanId(value?: string | null) {
  return value?.trim() || null
}

export function parseStaffAssignmentValue(value?: string | null): ParsedStaffAssignment {
  const [kind, ...rest] = (value?.trim() ?? '').split(':')
  const id = cleanId(rest.join(':'))
  return {
    assignedTo: kind === 'internal' ? id : null,
    externalStaffId: kind === 'external' ? id : null,
    externalProfileId: kind === 'external-profile' ? id : null,
  }
}

export function normalizeAppointmentAssignment({
  isShared,
  assignedTo,
  externalStaffId,
  externalProfileId,
}: AppointmentAssignmentInput): NormalizedAppointmentAssignment {
  const external_profile_id = cleanId(externalProfileId)
  const internalAssignmentAllowed = !isShared && !external_profile_id
  const external_staff_id = internalAssignmentAllowed ? cleanId(externalStaffId) : null
  return {
    assigned_to: internalAssignmentAllowed && !external_staff_id ? cleanId(assignedTo) : null,
    external_staff_id,
    external_profile_id,
  }
}

export const EXTERNAL_ASSIGNMENT_ACCESS_MESSAGE = 'Choose an External Staff member with access to this patient.'

export function isExternalAssignmentAccessError(error: { code?: string; message?: string } | null) {
  return error?.code === '23514' && error.message === EXTERNAL_ASSIGNMENT_ACCESS_MESSAGE
}
