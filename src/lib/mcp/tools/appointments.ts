import { buildAppointmentInsertRows } from '@/lib/appointments/appointment-creation'
import { getAppointmentVisibilityFilter } from '@/lib/access/appointment-visibility'
import { CLINIC_TIME_ZONE, getZonedDate } from '@/lib/timezone'
import type { McpToolDefinition, ToolContext } from '../registry.ts'
import { boolProp, enumProp, numberProp, objectSchema, stringProp } from '../schema.ts'
import { ToolError } from '../errors.ts'
import { resolveAppointmentFee } from '../appointment-fee.ts'
import { consumeResolutionToken, patientChoiceResult, resolvePatient, issueResolutionToken } from '../resolution.ts'
import { appointmentPublicView, normalizeAppointmentSelector, type AppointmentPublicSource } from '../appointment-output.ts'
import { resolveResolutionToken } from '../resolution.ts'

type JoinedPatient = { name: string; phone: string } | { name: string; phone: string }[] | null
type JoinedStaff = { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null
type JoinedExternalStaff = { name: string; email: string | null } | { name: string; email: string | null }[] | null

type AppointmentRow = {
  id: string
  patient_id: string
  date: string
  time: string
  duration_minutes: number
  type: string
  type_is_shared: boolean
  status: string
  notes: string | null
  assigned_to: string | null
  external_staff_id: string | null
  patient: JoinedPatient
}

type AppointmentViewRow = AppointmentRow & {
  assignee: JoinedStaff
  external_staff: JoinedExternalStaff
}

function joined<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function publicAppointment(row: AppointmentViewRow): AppointmentPublicSource {
  return {
    ...row,
    patient: joined(row.patient),
    assignee: joined(row.assignee),
    external_staff: joined(row.external_staff),
  }
}

function validateDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ToolError('date must use yyyy-MM-dd format.')
}

function validateTime(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) throw new ToolError('time must use HH:mm format.')
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

async function resolveAppointmentType(ctx: ToolContext, name: string) {
  if (!name.trim()) throw new ToolError('appointment_type_name is required.')
  const { data, error } = await ctx.supabase
    .from('appointment_types')
    .select('id, name, is_shared, sort_order, session_rate')
    .order('sort_order')
  if (error) throw error
  const types = (data ?? []) as Array<{ id: string; name: string; is_shared: boolean; sort_order: number; session_rate: number | null }>
  const exact = types.filter((type) => normalized(type.name) === normalized(name))
  if (exact.length === 1) return exact[0]
  const candidates = (exact.length ? exact : types.filter((type) => normalized(type.name).includes(normalized(name)))).slice(0, 10)
  if (!candidates.length) throw new ToolError('No appointment type matched that name.')
  return {
    ambiguous: true as const,
    candidates: candidates.map((type) => ({ appointment_type_name: type.name, session_rate: type.session_rate ?? null })),
  }
}

async function resolveAssignee(ctx: ToolContext, name: string | undefined) {
  if (!name?.trim()) return null
  const { data, error } = await ctx.supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('status', 'active')
    .order('full_name')
  if (error) throw error
  const profiles = (data ?? []) as Array<{ id: string; full_name: string | null; email: string }>
  const exact = profiles.filter((profile) => normalized(profile.full_name || profile.email) === normalized(name))
  if (exact.length === 1) return exact[0]
  const candidates = (exact.length ? exact : profiles.filter((profile) => normalized(profile.full_name || profile.email).includes(normalized(name)))).slice(0, 10)
  if (!candidates.length) throw new ToolError('No active staff member matched that name.')
  return { ambiguous: true as const, candidates: candidates.map((profile) => ({ staff_name: profile.full_name || profile.email })) }
}

async function resolveExternalAssignee(ctx: ToolContext, name: string | undefined) {
  if (!name?.trim()) return null
  const { data, error } = await ctx.supabase.from('external_staff').select('id, name, email').eq('status', 'active').order('name')
  if (error) throw error
  const staff = (data ?? []) as Array<{ id: string; name: string; email: string | null }>
  const exact = staff.filter((person) => normalized(person.name) === normalized(name))
  if (exact.length === 1) return exact[0]
  const candidates = (exact.length ? exact : staff.filter((person) => normalized(person.name).includes(normalized(name)))).slice(0, 10)
  if (!candidates.length) throw new ToolError('No active external staff member matched that name.')
  return { ambiguous: true as const, candidates: candidates.map((person) => ({ staff_name: person.name })) }
}

function appointmentSelect() {
  return 'id, patient_id, date, time, duration_minutes, type, type_is_shared, status, notes, assigned_to, external_staff_id, patient:patients(name, phone)'
}

async function addStaffLabels(ctx: ToolContext, rows: AppointmentRow[]): Promise<AppointmentViewRow[]> {
  const staffIds = [...new Set(rows.map((row) => row.assigned_to).filter(Boolean))] as string[]
  const externalIds = [...new Set(rows.map((row) => row.external_staff_id).filter(Boolean))] as string[]
  const [{ data: staff }, { data: externalStaff }] = await Promise.all([
    staffIds.length ? ctx.supabase.from('profiles').select('id, full_name, email').in('id', staffIds) : Promise.resolve({ data: [] }),
    externalIds.length ? ctx.supabase.from('external_staff').select('id, name, email').in('id', externalIds) : Promise.resolve({ data: [] }),
  ])
  const staffById = new Map((staff ?? []).map((row) => [row.id, row]))
  const externalById = new Map((externalStaff ?? []).map((row) => [row.id, row]))
  return rows.map((row) => ({
    ...row,
    assignee: row.assigned_to ? staffById.get(row.assigned_to) ?? null : null,
    external_staff: row.external_staff_id ? externalById.get(row.external_staff_id) ?? null : null,
  }))
}

export async function visibleAppointments(ctx: ToolContext, args: Record<string, unknown>) {
  const { date, patientName } = normalizeAppointmentSelector(args)
  const fromDate = typeof args.from_date === 'string' ? args.from_date.trim() : date
  const toDate = typeof args.to_date === 'string' ? args.to_date.trim() : date
  if (fromDate) validateDate(fromDate)
  if (toDate) validateDate(toDate)
  let query = ctx.supabase.from('appointments').select(appointmentSelect()).order('date').order('time').limit(100)
  if (fromDate) query = query.gte('date', fromDate)
  if (toDate) query = query.lte('date', toDate)
  if (typeof args.status === 'string' && args.status.trim()) query = query.eq('status', args.status.trim())
  const visibility = getAppointmentVisibilityFilter(ctx.profile)
  if (visibility) query = query.or(visibility)
  if (patientName) {
    const match = await resolvePatient(ctx, args)
    if (match.kind === 'none') return { rows: [] as AppointmentViewRow[], patientMatch: match }
    if (match.kind === 'ambiguous') return { rows: [] as AppointmentViewRow[], patientMatch: match }
    query = query.eq('patient_id', match.patient.id)
  }
  const { data, error } = await query
  if (error) throw error
  return { rows: await addStaffLabels(ctx, (data ?? []) as unknown as AppointmentRow[]), patientMatch: null }
}

const appointmentReadSchema = objectSchema({
  from_date: stringProp('Optional first date, yyyy-MM-dd'),
  to_date: stringProp('Optional last date, yyyy-MM-dd'),
  patient_name: stringProp('Optional patient name'),
  patient_selection_token: stringProp('Opaque patient token returned for an ambiguous name'),
  status: stringProp('Optional scheduled, completed, or cancelled'),
})

export const appointmentReadTools: McpToolDefinition[] = [
  {
    name: 'carebook_list_appointments',
    description: 'List visible appointments by date and optional patient name. Billing fields and raw identifiers are excluded.',
    scope: 'read',
    inputSchema: appointmentReadSchema,
    handler: async (args, ctx) => {
      const result = await visibleAppointments(ctx, args)
      if (result.patientMatch?.kind === 'ambiguous') return patientChoiceResult(ctx, result.patientMatch)
      const views = []
      for (const row of result.rows) views.push(appointmentPublicView(publicAppointment(row), await issueResolutionToken(ctx, 'appointment', row.id)))
      return { appointments: views, returned: views.length }
    },
  },
  {
    name: 'carebook_get_appointment',
    description: 'Get one visible appointment by an opaque selection token or by patient name, date, and time.',
    scope: 'read',
    inputSchema: objectSchema({
      patient_name: stringProp('Patient name'),
      patient_selection_token: stringProp('Opaque patient token returned for an ambiguous name'),
      date: stringProp('Appointment date, yyyy-MM-dd'),
      time: stringProp('Appointment time, HH:mm'),
      appointment_selection_token: stringProp('Opaque token from an appointment list'),
    }),
  handler: async (args, ctx) => {
      const appointmentId = typeof args.appointment_selection_token === 'string'
        ? await resolveResolutionToken(ctx, args.appointment_selection_token, 'appointment')
        : null
      let rows: AppointmentViewRow[] = []
      if (appointmentId) {
        const { data, error } = await ctx.supabase.from('appointments').select(appointmentSelect()).eq('id', appointmentId).maybeSingle()
        if (error) throw error
        rows = data ? await addStaffLabels(ctx, [data as unknown as AppointmentRow]) : []
      } else {
        const selector = normalizeAppointmentSelector(args)
        if (!selector.patientName || !selector.date || !selector.time) throw new ToolError('Provide patient_name, date, and time, or appointment_selection_token.')
        validateDate(selector.date)
        validateTime(selector.time)
        const patient = await resolvePatient(ctx, args)
        if (patient.kind === 'none') return { found: false, message: 'No patient matched that name.' }
        if (patient.kind === 'ambiguous') return patientChoiceResult(ctx, patient)
        const result = await visibleAppointments(ctx, { patient_name: selector.patientName, from_date: selector.date, to_date: selector.date })
        rows = result.rows.filter((row) => row.time.startsWith(selector.time))
      }
      if (rows.length > 1) {
        const candidates = []
        for (const row of rows.slice(0, 10)) candidates.push(appointmentPublicView(publicAppointment(row), await issueResolutionToken(ctx, 'appointment', row.id)))
        return { requires_appointment_confirmation: true, message: 'More than one appointment matched. Ask the user which one to use.', candidates }
      }
      if (!rows[0]) return { found: false, message: 'No appointment matched that selector.' }
      const { data: sessionNote, error: noteError } = await ctx.supabase
        .from('session_notes')
        .select('subjective, objective, assessment, plan, exercises_prescribed, created_at')
        .eq('appointment_id', rows[0].id)
        .maybeSingle()
      if (noteError) throw noteError
      return {
        found: true,
        appointment: appointmentPublicView(publicAppointment(rows[0]), await issueResolutionToken(ctx, 'appointment', rows[0].id)),
        session_note: sessionNote ?? null,
      }
    },
  },
]

export const sessionReadTools: McpToolDefinition[] = [
  {
    name: 'carebook_list_session_notes',
    description: 'List readable SOAP session notes for visible appointments. Notes are read-only through MCP.',
    scope: 'read',
    inputSchema: objectSchema({
      patient_name: stringProp('Optional patient name'),
      patient_selection_token: stringProp('Opaque patient token returned for an ambiguous name'),
      from_date: stringProp('Optional first session date, yyyy-MM-dd'),
      to_date: stringProp('Optional last session date, yyyy-MM-dd'),
      limit: numberProp('Optional maximum number of notes, capped at 50'),
    }),
    handler: async (args, ctx) => {
      const result = await visibleAppointments(ctx, args)
      if (result.patientMatch?.kind === 'ambiguous') return patientChoiceResult(ctx, result.patientMatch)
      const rows = result.rows.slice(0, Math.min(50, Math.max(1, typeof args.limit === 'number' ? Math.floor(args.limit) : 50)))
      if (!rows.length) return { session_notes: [], returned: 0 }
      const { data: notes, error } = await ctx.supabase.from('session_notes').select('appointment_id, subjective, objective, assessment, plan, exercises_prescribed, created_at').in('appointment_id', rows.map((row) => row.id)).order('created_at', { ascending: false })
      if (error) throw error
      const rowsById = new Map(rows.map((row) => [row.id, row]))
      const sessionNotes = (notes ?? []).flatMap((note) => {
        const appointment = rowsById.get(note.appointment_id)
        if (!appointment) return []
        const patient = joined(appointment.patient)
        return [{
          patient_name: patient?.name ?? null,
          date: appointment.date,
          time: appointment.time,
          appointment_type: appointment.type,
          subjective: note.subjective,
          objective: note.objective,
          assessment: note.assessment,
          plan: note.plan,
          exercises_prescribed: note.exercises_prescribed,
          created_at: note.created_at,
        }]
      })
      return { session_notes: sessionNotes, returned: sessionNotes.length }
    },
  },
]

/**
 * Load one appointment from an opaque selection token.
 *
 * The token is not consumed here: an edit is a preview-then-confirm pair, and burning the token on
 * the dry run would leave the caller holding nothing to confirm with. Tokens are grant-bound and
 * expire on their own, and the row is re-read through the caller's RLS on each call.
 */
async function loadAppointmentByToken(ctx: ToolContext, args: Record<string, unknown>): Promise<AppointmentViewRow> {
  const token = typeof args.appointment_selection_token === 'string' ? args.appointment_selection_token.trim() : ''
  if (!token) throw new ToolError('appointment_selection_token is required. List appointments first to obtain one.')
  const appointmentId = await resolveResolutionToken(ctx, token, 'appointment')
  if (!appointmentId) throw new ToolError('That appointment selection has expired. List appointments again.')
  const { data, error } = await ctx.supabase.from('appointments').select(appointmentSelect()).eq('id', appointmentId).maybeSingle()
  if (error) throw error
  if (!data) throw new ToolError('That appointment is no longer available.')
  const [row] = await addStaffLabels(ctx, [data as unknown as AppointmentRow])
  return row
}

async function appointmentSummary(ctx: ToolContext, row: AppointmentViewRow) {
  return appointmentPublicView(publicAppointment(row), await issueResolutionToken(ctx, 'appointment', row.id))
}

export const appointmentWriteTools: McpToolDefinition[] = [
  {
    name: 'carebook_create_appointment',
    description: 'Create one appointment or a recurrence using patient and appointment type names. Ambiguous patients and inline new-patient creation always require confirmation.',
    scope: 'write:clinical',
    inputSchema: objectSchema({
      patient_name: stringProp('Patient name; never a patient ID'),
      date: stringProp('Appointment date, yyyy-MM-dd'),
      time: stringProp('Appointment time, HH:mm'),
      appointment_type_name: stringProp('Appointment type name'),
      duration_minutes: numberProp('Optional duration, defaults to 45'),
      fee: numberProp('Session fee in rupees. Defaults to the appointment type session rate; required when that rate is 0 or unset'),
      notes: stringProp('Optional clinical appointment note'),
      assigned_to_name: stringProp('Optional internal staff name'),
      external_staff_name: stringProp('Optional external staff name'),
      recurrence_weekdays: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 } },
      recurrence_total_sessions: numberProp('Optional number of recurring sessions'),
      patient_selection_token: stringProp('Opaque patient token returned by a previous match'),
      new_patient: objectSchema({ name: stringProp('New patient name'), phone: stringProp('New patient phone'), email: stringProp('Optional email'), dob: stringProp('Optional date of birth, yyyy-MM-dd') }, ['name', 'phone']),
      confirm: boolProp('Set true to confirm inline patient creation'),
    }, ['patient_name', 'date', 'time', 'appointment_type_name']),
    handler: async (args, ctx) => {
      const patientName = typeof args.patient_name === 'string' ? args.patient_name.trim() : ''
      const date = typeof args.date === 'string' ? args.date.trim() : ''
      const time = typeof args.time === 'string' ? args.time.trim() : ''
      if (!patientName) throw new ToolError('patient_name is required.')
      validateDate(date)
      validateTime(time)
      const patient = await resolvePatient(ctx, { patient_name: patientName, patient_selection_token: args.patient_selection_token })
      if (patient.kind === 'ambiguous') return patientChoiceResult(ctx, patient)

      const appointmentType = await resolveAppointmentType(ctx, typeof args.appointment_type_name === 'string' ? args.appointment_type_name : '')
      if ('ambiguous' in appointmentType) return { requires_appointment_type_confirmation: true, candidates: appointmentType.candidates }

      const feeResolution = resolveAppointmentFee(args.fee, appointmentType.session_rate)
      if (feeResolution.kind === 'needs_fee') {
        return {
          requires_fee_confirmation: true,
          appointment_type: appointmentType.name,
          default_session_rate: feeResolution.defaultRate,
          message:
            feeResolution.defaultRate === null
              ? `The "${appointmentType.name}" type has no default session rate. Ask the user which appointment type and session fee to use, then call again with fee set.`
              : `The "${appointmentType.name}" type has a default session rate of 0. Confirm the appointment type and session fee with the user, then call again with fee set — passing fee: 0 explicitly books a free session.`,
        }
      }

      const assignee = await resolveAssignee(ctx, typeof args.assigned_to_name === 'string' ? args.assigned_to_name : undefined)
      if (assignee && 'ambiguous' in assignee) return { requires_staff_confirmation: true, candidates: assignee.candidates }
      const externalAssignee = await resolveExternalAssignee(ctx, typeof args.external_staff_name === 'string' ? args.external_staff_name : undefined)
      if (externalAssignee && 'ambiguous' in externalAssignee) return { requires_staff_confirmation: true, candidates: externalAssignee.candidates }
      if (assignee && externalAssignee) throw new ToolError('Choose either internal staff or external staff, not both.')

      const inlinePatient = args.new_patient && typeof args.new_patient === 'object' ? args.new_patient as Record<string, unknown> : null
      if (patient.kind === 'none' && !inlinePatient) return { requires_patient_confirmation: true, message: 'No patient matched. Provide new_patient with name and phone, then confirm: true to create the patient and appointment.' }
      if (patient.kind === 'selected' && inlinePatient) throw new ToolError('An existing patient matched this name; do not also provide new_patient.')
      if (inlinePatient) {
        const inlineName = typeof inlinePatient.name === 'string' ? inlinePatient.name.trim() : ''
        const inlinePhone = typeof inlinePatient.phone === 'string' ? inlinePatient.phone.trim() : ''
        if (!inlineName || !inlinePhone) throw new ToolError('new_patient.name and new_patient.phone are required.')
        if (normalized(inlineName) !== normalized(patientName)) throw new ToolError('new_patient.name must match patient_name.')
      }

      const recurrenceSessions = typeof args.recurrence_total_sessions === 'number' ? args.recurrence_total_sessions : undefined
      const weekdays = Array.isArray(args.recurrence_weekdays) ? args.recurrence_weekdays.filter((day): day is number => typeof day === 'number') : []
      const recurrence = recurrenceSessions ? { weekdays, totalSessions: recurrenceSessions } : null
      let rows
      try {
        rows = buildAppointmentInsertRows({
          patientId: patient.kind === 'selected' ? patient.patient.id : 'pending-patient',
          date,
          time,
          durationMinutes: typeof args.duration_minutes === 'number' ? args.duration_minutes : 45,
          appointmentTypeId: appointmentType.id,
          fee: feeResolution.fee,
          assignedTo: appointmentType.is_shared ? null : assignee?.id ?? null,
          externalStaffId: appointmentType.is_shared ? null : externalAssignee?.id ?? null,
          notes: typeof args.notes === 'string' && args.notes.trim() ? args.notes.trim() : null,
          recurrence,
          today: getZonedDate(new Date(), CLINIC_TIME_ZONE),
        })
      } catch (error) {
        throw new ToolError(error instanceof Error ? error.message : 'The repeat schedule is invalid.')
      }

      const preview = {
        patient_name: patient.kind === 'selected' ? patient.patient.name : patientName,
        appointment_type: appointmentType.name,
        dates: rows.map((row) => row.date),
        time,
        duration_minutes: typeof args.duration_minutes === 'number' ? args.duration_minutes : 45,
        fee: feeResolution.fee,
      }
      if (inlinePatient && args.confirm !== true) return { dry_run: true, action: 'create_patient_and_appointment', preview: { ...preview, new_patient: inlinePatient } }

      const supabase = ctx.supabase
      const patientSelectionToken = typeof args.patient_selection_token === 'string' ? args.patient_selection_token.trim() : ''
      if (patientSelectionToken) {
        if (patient.kind !== 'selected') throw new ToolError('That patient selection has expired. Search again.')
        const consumed = await consumeResolutionToken(ctx, patientSelectionToken, 'patient')
        if (!consumed || consumed !== patient.patient.id) throw new ToolError('That patient selection has expired. Search again.')
      }
      let patientId = patient.kind === 'selected' ? patient.patient.id : ''
      if (inlinePatient) {
        const { data: created, error } = await supabase.from('patients').insert({
          name: inlinePatient.name,
          phone: inlinePatient.phone,
          email: typeof inlinePatient.email === 'string' ? inlinePatient.email.trim() || null : null,
          dob: typeof inlinePatient.dob === 'string' ? inlinePatient.dob.trim() || null : null,
        }).select('id').single()
        if (error || !created) throw new ToolError('Unable to create the new patient.')
        patientId = created.id
      }
      if (!patientId) throw new ToolError('No patient was selected.')
      const appointmentRows = rows.map((row) => ({ ...row, patient_id: patientId }))
      const generatedDates = appointmentRows.map((row) => row.date)
      const { data: conflicts, error: conflictError } = await supabase.from('appointments').select('date').eq('patient_id', patientId).eq('time', time).in('date', generatedDates)
      if (conflictError) throw new ToolError('Unable to check the appointment schedule.')
      const conflictingDates = [...new Set((conflicts ?? []).map((row) => row.date))].sort()
      if (conflictingDates.length) return { created: false, error_code: 'APPOINTMENT_CONFLICT', conflicting_dates: conflictingDates, message: 'This patient already has an appointment at the selected time.' }
      const { data: createdAppointments, error } = await supabase.from('appointments').insert(appointmentRows).select('id, date, time')
      if (error || !createdAppointments || createdAppointments.length !== appointmentRows.length) throw new ToolError('Unable to create the appointment.')
      const appointments = []
      for (const created of createdAppointments) appointments.push({ date: created.date, time: created.time, appointment_selection_token: await issueResolutionToken(ctx, 'appointment', created.id) })
      return { created: true, fee: feeResolution.fee, appointments }
    },
  },
  {
    name: 'carebook_update_appointment',
    description:
      'Reschedule or amend one appointment identified by an opaque selection token. Previews the change and only writes when confirm is true. Session fees are not editable here — use the billing tools for that.',
    scope: 'write:clinical',
    inputSchema: objectSchema({
      appointment_selection_token: stringProp('Opaque token from a previous appointment list or lookup'),
      date: stringProp('Optional new date, yyyy-MM-dd'),
      time: stringProp('Optional new time, HH:mm'),
      duration_minutes: numberProp('Optional new duration in minutes'),
      notes: stringProp('Optional replacement clinical note'),
      assigned_to_name: stringProp('Optional internal staff name'),
      external_staff_name: stringProp('Optional external staff name'),
      confirm: boolProp('Set true to apply the previewed change'),
    }, ['appointment_selection_token']),
    handler: async (args, ctx) => {
      const row = await loadAppointmentByToken(ctx, args)
      if (row.status !== 'scheduled') throw new ToolError(`Only scheduled appointments can be edited. This one is ${row.status}.`)

      const changes: Record<string, unknown> = {}
      if (typeof args.date === 'string' && args.date.trim()) {
        validateDate(args.date.trim())
        changes.date = args.date.trim()
      }
      if (typeof args.time === 'string' && args.time.trim()) {
        validateTime(args.time.trim())
        changes.time = args.time.trim()
      }
      if (typeof args.duration_minutes === 'number' && Number.isFinite(args.duration_minutes)) {
        if (args.duration_minutes <= 0) throw new ToolError('duration_minutes must be greater than zero.')
        changes.duration_minutes = Math.floor(args.duration_minutes)
      }
      if (typeof args.notes === 'string') changes.notes = args.notes.trim() || null

      const assignee = await resolveAssignee(ctx, typeof args.assigned_to_name === 'string' ? args.assigned_to_name : undefined)
      if (assignee && 'ambiguous' in assignee) return { requires_staff_confirmation: true, candidates: assignee.candidates }
      const externalAssignee = await resolveExternalAssignee(ctx, typeof args.external_staff_name === 'string' ? args.external_staff_name : undefined)
      if (externalAssignee && 'ambiguous' in externalAssignee) return { requires_staff_confirmation: true, candidates: externalAssignee.candidates }
      if (assignee && externalAssignee) throw new ToolError('Choose either internal staff or external staff, not both.')
      // A shared type is visible to everyone, so it carries no assignee by design.
      if (assignee) {
        if (row.type_is_shared) throw new ToolError(`"${row.type}" is a shared appointment type and cannot be assigned to one staff member.`)
        changes.assigned_to = assignee.id
        changes.external_staff_id = null
      }
      if (externalAssignee) {
        if (row.type_is_shared) throw new ToolError(`"${row.type}" is a shared appointment type and cannot be assigned to one staff member.`)
        changes.external_staff_id = externalAssignee.id
        changes.assigned_to = null
      }

      if (Object.keys(changes).length === 0) throw new ToolError('Provide at least one field to change.')

      const targetDate = typeof changes.date === 'string' ? changes.date : row.date
      const targetTime = typeof changes.time === 'string' ? changes.time : row.time
      if (targetDate !== row.date || targetTime !== row.time) {
        const { data: clash, error: clashError } = await ctx.supabase
          .from('appointments')
          .select('id')
          .eq('patient_id', row.patient_id)
          .eq('date', targetDate)
          .eq('time', targetTime)
          .neq('id', row.id)
        if (clashError) throw new ToolError('Unable to check the appointment schedule.')
        if (clash?.length) {
          return { updated: false, error_code: 'APPOINTMENT_CONFLICT', message: 'This patient already has an appointment at that date and time.' }
        }
      }

      if (args.confirm !== true) {
        return { dry_run: true, action: 'update_appointment', current: await appointmentSummary(ctx, row), changes }
      }

      const { error } = await ctx.supabase.from('appointments').update(changes).eq('id', row.id)
      if (error) throw error
      const updated = await loadAppointmentByToken(ctx, args)
      return { updated: true, appointment: await appointmentSummary(ctx, updated) }
    },
  },
  {
    name: 'carebook_set_appointment_status',
    description:
      'Mark one appointment completed or cancelled, or restore it to scheduled. Identified by an opaque selection token; previews the change unless confirm is true.',
    scope: 'write:clinical',
    inputSchema: objectSchema({
      appointment_selection_token: stringProp('Opaque token from a previous appointment list or lookup'),
      status: enumProp('New status', ['scheduled', 'completed', 'cancelled']),
      confirm: boolProp('Set true to apply the previewed change'),
    }, ['appointment_selection_token', 'status']),
    handler: async (args, ctx) => {
      const status = typeof args.status === 'string' ? args.status.trim() : ''
      if (!['scheduled', 'completed', 'cancelled'].includes(status)) {
        throw new ToolError('status must be scheduled, completed, or cancelled.')
      }
      const row = await loadAppointmentByToken(ctx, args)
      if (row.status === status) return { updated: false, message: `That appointment is already ${status}.` }

      if (args.confirm !== true) {
        return {
          dry_run: true,
          action: 'set_appointment_status',
          current: await appointmentSummary(ctx, row),
          changes: { status },
          // Completing a session posts its charge to the ledger, so the caller should say so out loud.
          billing_effect:
            status === 'completed'
              ? 'Completing this session posts its charge to the billing ledger.'
              : status === 'cancelled'
                ? 'Cancelling voids this session\'s charge in the billing ledger.'
                : 'Restoring this session returns its charge to pending.',
        }
      }

      const { error } = await ctx.supabase.from('appointments').update({ status }).eq('id', row.id)
      if (error) throw error
      const updated = await loadAppointmentByToken(ctx, args)
      return { updated: true, appointment: await appointmentSummary(ctx, updated) }
    },
  },
  {
    name: 'carebook_delete_appointment',
    description:
      'Permanently delete one scheduled appointment identified by an opaque selection token. Admin only, and only while the appointment is still scheduled — cancel it instead to keep the record.',
    scope: 'write:clinical',
    adminOnly: true,
    inputSchema: objectSchema({
      appointment_selection_token: stringProp('Opaque token from a previous appointment list or lookup'),
      confirm: boolProp('Set true to apply the previewed deletion'),
    }, ['appointment_selection_token']),
    handler: async (args, ctx) => {
      const row = await loadAppointmentByToken(ctx, args)
      // Mirrors the web rule in src/app/schedule/actions.ts: a delivered or cancelled session is a
      // record of something that happened and stays on the books.
      if (row.status !== 'scheduled') {
        throw new ToolError(`Only scheduled appointments can be deleted. This one is ${row.status} — cancel it instead to keep the record.`)
      }
      if (args.confirm !== true) {
        return {
          dry_run: true,
          action: 'delete_appointment',
          current: await appointmentSummary(ctx, row),
          message: 'This permanently removes the appointment. Cancelling instead keeps it on the record.',
        }
      }
      const { error } = await ctx.supabase.from('appointments').delete().eq('id', row.id)
      if (error) throw error
      return { deleted: true, date: row.date, time: row.time, patient_name: joined(row.patient)?.name ?? null }
    },
  },
]
