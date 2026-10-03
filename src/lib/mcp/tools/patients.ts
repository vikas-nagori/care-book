import type { McpToolDefinition } from '../registry.ts'
import { boolProp, objectSchema, stringProp } from '../schema.ts'
import { patientChoiceResult, resolvePatient, findPatients, issueResolutionToken } from '../resolution.ts'
import { publicPatientCandidate } from '../patient-resolution.ts'
import { ToolError } from '../errors.ts'

const PATIENT_FIELDS = {
  name: stringProp('Patient full name'),
  phone: stringProp('Required phone number'),
  email: stringProp('Optional email'),
  dob: stringProp('Optional date of birth as yyyy-MM-dd'),
  gender: stringProp('Optional gender'),
  address: stringProp('Optional address'),
  medical_history: stringProp('Optional medical history'),
  notes: stringProp('Optional patient notes'),
}

export const patientReadTools: McpToolDefinition[] = [
  {
    name: 'carebook_search_patients',
    description: 'Search patients by name. Use the returned opaque selection token when multiple patients match; raw patient IDs are never returned.',
    scope: 'read',
    inputSchema: objectSchema({ patient_name: stringProp('Name or partial name to search') }, ['patient_name']),
    handler: async (args, ctx) => {
      const name = typeof args.patient_name === 'string' ? args.patient_name : ''
      const matches = await findPatients(ctx, name)
      const candidates = []
      for (const match of matches.slice(0, 20)) {
        candidates.push({ ...publicPatientCandidate(match), patient_selection_token: await issueResolutionToken(ctx, 'patient', match.id) })
      }
      return { candidates, returned: candidates.length }
    },
  },
  {
    name: 'carebook_get_patient',
    description: 'Return non-billing details and treatment plans for one patient selected by name.',
    scope: 'read',
    inputSchema: objectSchema({ patient_name: stringProp('Patient full name'), patient_selection_token: stringProp('Opaque token returned when the name was ambiguous') }, ['patient_name']),
    handler: async (args, ctx) => {
      const match = await resolvePatient(ctx, args)
      if (match.kind === 'none') return { found: false, message: 'No patient matched that name.' }
      if (match.kind === 'ambiguous') return patientChoiceResult(ctx, match)
      const { data: patient, error } = await ctx.supabase
        .from('patients')
        .select('name, phone, email, dob, gender, address, medical_history, notes, referral_source, referral_other, treatment_plans(diagnosis, goals, start_date, expected_end_date, status)')
        .eq('id', match.patient.id)
        .maybeSingle()
      if (error) throw error
      if (!patient) return { found: false, message: 'No patient matched that name.' }
      return { found: true, patient }
    },
  },
]

export const patientWriteTools: McpToolDefinition[] = [
  {
    name: 'carebook_create_patient',
    description: 'Create a new patient after searching by name. A possible existing match returns candidates instead of writing. Use confirm: true after the no-match preview.',
    scope: 'write:clinical',
    inputSchema: objectSchema({ ...PATIENT_FIELDS, confirm: boolProp('Set true after reviewing the no-match preview') }, ['name', 'phone']),
    handler: async (args, ctx) => {
      const name = typeof args.name === 'string' ? args.name.trim() : ''
      const phone = typeof args.phone === 'string' ? args.phone.trim() : ''
      if (!name || !phone) throw new ToolError('name and phone are required.')
      const match = await resolvePatient(ctx, { patient_name: name })
      if (match.kind === 'selected') return { created: false, requires_patient_confirmation: true, message: 'A patient with this exact name already exists. Use the existing patient instead.', candidate: publicPatientCandidate(match.patient) }
      if (match.kind === 'ambiguous') return patientChoiceResult(ctx, match)
      if (args.confirm !== true) return { dry_run: true, action: 'create_patient', preview: { name, phone, message: 'No existing patient matched. Confirm before creating this patient.' } }
      const { data, error } = await ctx.supabase.from('patients').insert({
        name,
        phone,
        email: typeof args.email === 'string' && args.email.trim() ? args.email.trim() : null,
        dob: typeof args.dob === 'string' && args.dob.trim() ? args.dob.trim() : null,
        gender: typeof args.gender === 'string' && args.gender.trim() ? args.gender.trim() : null,
        address: typeof args.address === 'string' && args.address.trim() ? args.address.trim() : null,
        medical_history: typeof args.medical_history === 'string' && args.medical_history.trim() ? args.medical_history.trim() : null,
        notes: typeof args.notes === 'string' && args.notes.trim() ? args.notes.trim() : null,
      }).select('name, phone, email, dob, gender, address, medical_history, notes').single()
      if (error) throw error
      return { created: true, patient: data }
    },
  },
]
