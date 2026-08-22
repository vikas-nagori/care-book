import { createAdminClient } from '../supabase/admin.ts'
import { ToolError } from './errors.ts'
import type { ToolContext } from './registry.ts'
import { generateToken, hashToken } from './tokens.ts'
import { classifyPatientMatches, normalizePatientName, publicPatientCandidate, type PatientCandidate } from './patient-resolution.ts'
import { rankByName } from './fuzzy-match.ts'

export type ResolutionEntity = 'patient' | 'payment' | 'package' | 'appointment'

export async function issueResolutionToken(ctx: ToolContext, entityType: ResolutionEntity, entityId: string) {
  const token = generateToken('selection')
  const admin = createAdminClient()
  // Same self-limiting sweep as authorization codes: these expire in ten minutes and are never
  // read again afterwards, so anything a day old is dead weight.
  await admin
    .from('mcp_resolution_tokens')
    .delete()
    .lt('expires_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  const { error } = await admin.from('mcp_resolution_tokens').insert({
    grant_id: ctx.grant.grantId,
    user_id: ctx.grant.userId,
    clinic_id: ctx.grant.clinicId,
    token_hash: hashToken(token),
    entity_type: entityType,
    entity_id: entityId,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  })
  if (error) throw new ToolError('Unable to create a temporary record-selection token.')
  return token
}

export async function resolveResolutionToken(ctx: ToolContext, token: string, entityType: ResolutionEntity, consume = false) {
  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('mcp_resolution_tokens')
    .select('id, entity_id')
    .eq('token_hash', hashToken(token))
    .eq('grant_id', ctx.grant.grantId)
    .eq('user_id', ctx.grant.userId)
    .eq('clinic_id', ctx.grant.clinicId)
    .eq('entity_type', entityType)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error || !row) return null
  if (consume) {
    const { error: consumeError } = await admin
      .from('mcp_resolution_tokens')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('consumed_at', null)
    if (consumeError) return null
  }
  return String(row.entity_id)
}

export async function consumeResolutionToken(ctx: ToolContext, token: string, entityType: ResolutionEntity) {
  return resolveResolutionToken(ctx, token, entityType, true)
}

/** Ceiling on the rows pulled in for scoring. Clinics hold tens of patients; this is a guard rail. */
const PATIENT_SCAN_LIMIT = 2000

export async function findPatients(ctx: ToolContext, patientName: string): Promise<PatientCandidate[]> {
  const term = patientName.trim()
  if (!term) throw new ToolError('patient_name is required.')

  // A typo cannot be expressed as a SQL containment match, so the shortlist has to be scored rather
  // than filtered. RLS has already narrowed this to the caller's own clinic before it reaches here.
  const { data, error } = await ctx.supabase
    .from('patients')
    .select('id, name, phone, dob')
    .order('name')
    .limit(PATIENT_SCAN_LIMIT)
  if (error) throw error

  const patients = (data ?? []) as Array<{ id: string; name: string; phone: string | null; dob: string | null }>
  return rankByName(term, patients, (patient) => patient.name)
    .slice(0, 20)
    .map(({ item, score }) => ({ id: item.id, name: item.name, phone: item.phone, dob: item.dob, matchScore: score }))
}

export async function resolvePatient(ctx: ToolContext, args: Record<string, unknown>) {
  const patientName = typeof args.patient_name === 'string' ? args.patient_name : ''
  if (!normalizePatientName(patientName)) throw new ToolError('patient_name is required.')

  const selection = typeof args.patient_selection_token === 'string' ? args.patient_selection_token.trim() : ''
  if (selection) {
    const patientId = await resolveResolutionToken(ctx, selection, 'patient')
    if (!patientId) return { kind: 'none' as const }
    const { data, error } = await ctx.supabase.from('patients').select('id, name, phone, dob').eq('id', patientId).maybeSingle()
    if (error) throw error
    return data ? { kind: 'selected' as const, patient: data as PatientCandidate } : { kind: 'none' as const }
  }

  const candidates = await findPatients(ctx, patientName)
  return classifyPatientMatches(patientName, candidates)
}

export async function patientChoiceResult(ctx: ToolContext, match: { kind: 'ambiguous'; candidates: PatientCandidate[] }) {
  const candidates = []
  for (const candidate of match.candidates.slice(0, 10)) {
    candidates.push({ ...publicPatientCandidate(candidate), patient_selection_token: await issueResolutionToken(ctx, 'patient', candidate.id) })
  }
  return {
    requires_patient_confirmation: true,
    message:
      'More than one patient could match that name. Ask the user which candidate to use — do not guess, even if one name looks like an exact match — then call again with the matching patient_selection_token.',
    candidates,
  }
}
