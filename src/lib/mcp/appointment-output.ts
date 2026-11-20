export type AppointmentPublicSource = {
  id: string
  patient_id: string
  clinic_id?: string
  date: string
  time: string
  duration_minutes: number
  type: string
  type_is_shared: boolean
  status: string
  fee?: number | null
  payment_status?: string
  notes: string | null
  patient: { name: string; phone: string } | null
  assignee: { full_name: string | null; email: string } | null
  external_staff: { name: string; email: string | null } | null
  external_profile?: { full_name: string | null; email: string } | null
}

export function normalizeAppointmentSelector(args: Record<string, unknown>) {
  return {
    date: typeof args.date === 'string' ? args.date.trim() : '',
    time: typeof args.time === 'string' ? args.time.trim() : '',
    patientName: typeof args.patient_name === 'string' ? args.patient_name.trim() : '',
  }
}

export function appointmentPublicView(row: AppointmentPublicSource, selectionToken: string) {
  const assignedStaffName = row.external_profile
    ? row.external_profile.full_name || row.external_profile.email
    : row.type_is_shared ? null : row.external_staff?.name ?? row.assignee?.full_name ?? row.assignee?.email

  return {
    appointment_selection_token: selectionToken,
    patient_name: row.patient?.name ?? null,
    patient_phone: row.patient?.phone ?? null,
    date: row.date,
    time: row.time,
    duration_minutes: row.duration_minutes,
    appointment_type: row.type,
    status: row.status,
    notes: row.notes,
    ...(assignedStaffName == null ? {} : { assigned_staff_name: assignedStaffName }),
  }
}
