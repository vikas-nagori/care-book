import { callBillingRpc, validateBillingEntry, validateReasonedMutation, validateRecordPayment } from '@/lib/billing/mutations'
import type { McpToolDefinition, ToolContext } from '../registry.ts'
import { boolProp, enumProp, numberProp, objectSchema, stringProp } from '../schema.ts'
import { PAYMENT_METHODS, normalizePaymentMethod, paymentMethodError } from '../payment-method.ts'
import { ToolError } from '../errors.ts'
import { dryRun, isConfirmed, requireIdempotencyKey } from '../confirm.ts'
import { consumeResolutionToken, issueResolutionToken, resolveResolutionToken, resolvePatient } from '../resolution.ts'
import { patientChoiceResult } from '../resolution.ts'

function text(args: Record<string, unknown>, key: string) {
  return typeof args[key] === 'string' ? String(args[key]).trim() : ''
}

function failValidation(result: { ok: false; message: string }): never {
  throw new ToolError(result.message)
}

async function resolveAppointmentTypeId(ctx: ToolContext, name: string) {
  if (!name) throw new ToolError('appointment_type_name is required.')
  const { data, error } = await ctx.supabase.from('appointment_types').select('id, name').order('sort_order')
  if (error) throw error
  const types = (data ?? []) as Array<{ id: string; name: string }>
  const exact = types.filter((candidate) => candidate.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())
  if (exact.length === 1) return exact[0].id
  const candidates = (exact.length ? exact : types.filter((candidate) => candidate.name.toLocaleLowerCase().includes(name.toLocaleLowerCase()))).slice(0, 10)
  if (!candidates.length) throw new ToolError('No appointment type matched that name.')
  throw new ToolError(`More than one appointment type matched: ${candidates.map((candidate) => candidate.name).join(', ')}. Provide one exact appointment_type_name.`)
}

type BillingPatientResolution = { patient: { id: string; name: string; phone?: string | null; dob?: string | null } } | { choice: Record<string, unknown> }

async function resolvePatientForBilling(ctx: ToolContext, args: Record<string, unknown>): Promise<BillingPatientResolution> {
  const match = await resolvePatient(ctx, args)
  if (match.kind === 'ambiguous') return { choice: await patientChoiceResult(ctx, match) as Record<string, unknown> }
  if (match.kind === 'none') throw new ToolError('No patient matched that name.')
  return { patient: match.patient }
}

type BillingTarget = { id: string; patientId: string; selectionToken?: string; selectionType?: 'payment' | 'package' | 'appointment' }

async function resolvePayment(ctx: ToolContext, args: Record<string, unknown>): Promise<BillingTarget | { choice: Record<string, unknown> }> {
  const selection = text(args, 'payment_selection_token')
  if (selection) {
    const id = await resolveResolutionToken(ctx, selection, 'payment')
    if (!id) throw new ToolError('That payment selection has expired. Search again.')
    const { data, error } = await ctx.supabase.from('payments').select('id, patient_id').eq('id', id).maybeSingle()
    if (error || !data) throw new ToolError('The selected payment is no longer available.')
    return { id: data.id, patientId: data.patient_id, selectionToken: selection, selectionType: 'payment' }
  }
  const patient = await resolvePatientForBilling(ctx, args)
  if ('choice' in patient) return { choice: patient.choice }
  let query = ctx.supabase.from('payments').select('id, patient_id, date, amount, payment_method, status').eq('patient_id', patient.patient.id).order('date', { ascending: false }).limit(20)
  if (text(args, 'payment_date')) query = query.eq('date', text(args, 'payment_date'))
  if (typeof args.amount === 'number' && Number.isFinite(args.amount)) query = query.eq('amount', args.amount)
  if (text(args, 'payment_method')) query = query.ilike('payment_method', text(args, 'payment_method'))
  const { data, error } = await query
  if (error) throw error
  const matches = (data ?? []) as Array<{ id: string; patient_id: string; date: string; amount: number; payment_method: string; status: string }>
  if (matches.length === 1) return { id: matches[0].id, patientId: matches[0].patient_id }
  if (!matches.length) throw new ToolError('No matching payment was found.')
  const candidates = []
  for (const match of matches.slice(0, 10)) candidates.push({ payment_date: match.date, amount: Number(match.amount), payment_method: match.payment_method, payment_selection_token: await issueResolutionToken(ctx, 'payment', match.id) })
  return { choice: { requires_billing_entity_confirmation: true, message: 'More than one payment matched. Ask the user which payment to use.', candidates } }
}

async function resolvePackage(ctx: ToolContext, args: Record<string, unknown>): Promise<BillingTarget | { choice: Record<string, unknown> }> {
  const selection = text(args, 'package_selection_token')
  if (selection) {
    const id = await resolveResolutionToken(ctx, selection, 'package')
    if (!id) throw new ToolError('That package selection has expired. Search again.')
    const { data, error } = await ctx.supabase.from('packages').select('id, patient_id').eq('id', id).maybeSingle()
    if (error || !data) throw new ToolError('The selected package is no longer available.')
    return { id: data.id, patientId: data.patient_id, selectionToken: selection, selectionType: 'package' }
  }
  const patient = await resolvePatientForBilling(ctx, args)
  if ('choice' in patient) return { choice: patient.choice }
  const packageName = text(args, 'package_name')
  if (!packageName) throw new ToolError('package_name is required.')
  const { data, error } = await ctx.supabase.from('packages').select('id, patient_id, name, status, starts_on').eq('patient_id', patient.patient.id).ilike('name', `%${packageName.replace(/[%_]/g, '')}%`).order('created_at', { ascending: false }).limit(20)
  if (error) throw error
  const matches = (data ?? []) as Array<{ id: string; patient_id: string; name: string; status: string; starts_on: string | null }>
  if (matches.length === 1) return { id: matches[0].id, patientId: matches[0].patient_id }
  if (!matches.length) throw new ToolError('No matching package was found.')
  const candidates = []
  for (const match of matches.slice(0, 10)) candidates.push({ package_name: match.name, package_start_date: match.starts_on, package_selection_token: await issueResolutionToken(ctx, 'package', match.id) })
  return { choice: { requires_billing_entity_confirmation: true, message: 'More than one package matched. Ask the user which package to use.', candidates } }
}

async function resolveAppointmentTarget(ctx: ToolContext, args: Record<string, unknown>): Promise<BillingTarget | { choice: Record<string, unknown> }> {
  const selection = text(args, 'appointment_selection_token')
  if (selection) {
    const id = await resolveResolutionToken(ctx, selection, 'appointment')
    if (!id) throw new ToolError('That appointment selection has expired. Search again.')
    const { data, error } = await ctx.supabase.from('appointments').select('id, patient_id').eq('id', id).maybeSingle()
    if (error || !data) throw new ToolError('The selected appointment is no longer available.')
    return { id: data.id, patientId: data.patient_id, selectionToken: selection, selectionType: 'appointment' }
  }
  const patient = await resolvePatientForBilling(ctx, args)
  if ('choice' in patient) return { choice: patient.choice }
  const date = text(args, 'date')
  const time = text(args, 'time')
  if (!date || !time) throw new ToolError('Provide appointment_selection_token or patient_name, date, and time.')
  const { data, error } = await ctx.supabase.from('appointments').select('id, patient_id, date, time, type, status').eq('patient_id', patient.patient.id).eq('date', date).like('time', `${time}%`).limit(20)
  if (error) throw error
  const matches = (data ?? []) as Array<{ id: string; patient_id: string; date: string; time: string; type: string; status: string }>
  if (matches.length === 1) return { id: matches[0].id, patientId: matches[0].patient_id }
  if (!matches.length) throw new ToolError('No matching appointment was found.')
  const candidates = []
  for (const match of matches.slice(0, 10)) candidates.push({ date: match.date, time: match.time, appointment_type: match.type, appointment_selection_token: await issueResolutionToken(ctx, 'appointment', match.id) })
  return { choice: { requires_billing_entity_confirmation: true, message: 'More than one appointment matched. Ask the user which appointment to use.', candidates } }
}

function billingInputSchema(properties: Record<string, unknown>, required: string[]) {
  return objectSchema({ ...properties, confirm: boolProp('Set true to perform the audited write'), idempotency_key: stringProp('Stable key for safe retries') }, [...required, 'confirm', 'idempotency_key'])
}

function ensureKey(args: Record<string, unknown>) {
  requireIdempotencyKey(args)
}

async function consumePatientSelection(ctx: ToolContext, args: Record<string, unknown>, patientId: string) {
  const token = text(args, 'patient_selection_token')
  if (!token) return
  const resolved = await consumeResolutionToken(ctx, token, 'patient')
  if (!resolved || resolved !== patientId) throw new ToolError('That patient selection has expired. Search again.')
}

async function consumeTargetSelection(ctx: ToolContext, target: BillingTarget) {
  if (!target.selectionToken || !target.selectionType) return
  const resolved = await consumeResolutionToken(ctx, target.selectionToken, target.selectionType)
  if (!resolved || resolved !== target.id) throw new ToolError('That billing selection has expired. Search again.')
}

async function runRpc(ctx: ToolContext, rpc: string, params: Record<string, unknown>, message: string) {
  const result = await callBillingRpc(ctx.supabase, rpc, params, { grantId: ctx.grant.grantId, mcp: true })
  if (!result?.success) {
    // The RPCs reject on business rules with messages written for the end user, and migration 037
    // already strips anything schema-revealing via private.billing_error_response. Replacing that
    // with a generic line leaves the caller unable to fix the input — which is exactly what
    // happened when "UPI" was refused for not being "upi".
    const detail = typeof result?.message === 'string' ? result.message.trim() : ''
    throw new ToolError(detail ? `${message} ${detail}` : message)
  }
  return result
}

/** Map a caller-supplied method onto the set the RPCs accept, failing loudly rather than guessing. */
function requirePaymentMethod(args: Record<string, unknown>, key: string) {
  const normalized = normalizePaymentMethod(args[key])
  if (!normalized) throw new ToolError(paymentMethodError(key))
  return normalized
}

export const billingWriteTools: McpToolDefinition[] = [
  {
    name: 'carebook_record_payment',
    description: 'Record a standalone ordinary payment for a patient selected by name. Requires a dry-run review, confirmation, and idempotency key; no billing history is returned.',
    scope: 'write:billing',
    adminOnly: true,
    inputSchema: billingInputSchema({ patient_name: stringProp('Patient name'), amount: numberProp('Payment amount'), payment_method: enumProp('Payment method', [...PAYMENT_METHODS]), date: stringProp('Payment date, yyyy-MM-dd'), notes: stringProp('Optional note'), patient_selection_token: stringProp('Opaque patient token') }, ['patient_name', 'amount', 'payment_method', 'date']),
    handler: async (args, ctx) => {
      ensureKey(args)
      const patient = await resolvePatientForBilling(ctx, args)
      if ('choice' in patient) return patient.choice
      const validated = validateRecordPayment({ patientId: patient.patient.id, amount: Number(args.amount), paymentMethod: requirePaymentMethod(args, 'payment_method'), date: text(args, 'date'), notes: text(args, 'notes') || null })
      if (!validated.ok) failValidation(validated)
      const preview = { patient_name: patient.patient.name, ...validated.summary }
      if (!isConfirmed(args)) return dryRun('record_payment', preview)
      await consumePatientSelection(ctx, args, patient.patient.id)
      const result = await runRpc(ctx, validated.rpc, validated.params, 'Unable to record this payment.')
      if (result.paymentId) ctx.auditEntity = { type: 'payment', id: String(result.paymentId) }
      return { recorded: true, payment_selection_token: result.paymentId ? await issueResolutionToken(ctx, 'payment', String(result.paymentId)) : null }
    },
  },
  {
    name: 'carebook_record_billing_entry',
    description: 'Record a payment-only or fully paid package entry. Requires confirmation and an idempotency key; it never returns package lists, balances, or billing history.',
    scope: 'write:billing',
    adminOnly: true,
    inputSchema: billingInputSchema({ patient_name: stringProp('Patient name'), mode: { type: 'string', enum: ['payment_only', 'package_with_payment'] }, package_name: stringProp('Package name when mode is package_with_payment'), total_sessions: numberProp('Package session count'), per_session_amount: numberProp('Package per-session amount'), appointment_type_name: stringProp('Appointment type name for a package'), package_start_date: stringProp('Package start date'), amount: numberProp('Payment amount'), payment_method: enumProp('Payment method', [...PAYMENT_METHODS]), payment_date: stringProp('Payment date'), notes: stringProp('Payment/package notes'), patient_selection_token: stringProp('Opaque patient token') }, ['patient_name', 'mode', 'amount', 'payment_method', 'payment_date']),
    handler: async (args, ctx) => {
      ensureKey(args)
      const patient = await resolvePatientForBilling(ctx, args)
      if ('choice' in patient) return patient.choice
      const mode = text(args, 'mode') as 'payment_only' | 'package_with_payment'
      const appointmentTypeId = mode === 'package_with_payment' ? await resolveAppointmentTypeId(ctx, text(args, 'appointment_type_name')) : undefined
      const validated = validateBillingEntry({ patientId: patient.patient.id, mode, packageName: text(args, 'package_name') || undefined, packageTotalSessions: typeof args.total_sessions === 'number' ? args.total_sessions : undefined, packagePerSessionAmount: typeof args.per_session_amount === 'number' ? args.per_session_amount : undefined, appointmentTypeId, packageStartsOn: text(args, 'package_start_date') || undefined, paymentAmount: Number(args.amount), paymentMethod: requirePaymentMethod(args, 'payment_method'), paymentDate: text(args, 'payment_date'), paymentNotes: text(args, 'notes') || null })
      if (!validated.ok) failValidation(validated)
      if (!isConfirmed(args)) return dryRun('record_billing_entry', { patient_name: patient.patient.name, ...validated.summary })
      await consumePatientSelection(ctx, args, patient.patient.id)
      const result = await runRpc(ctx, validated.rpc, validated.params, 'Unable to save this billing entry.')
      if (result.packageId) ctx.auditEntity = { type: 'package', id: String(result.packageId) }
      else if (result.paymentId) ctx.auditEntity = { type: 'payment', id: String(result.paymentId) }
      return {
        recorded: true,
        package_selection_token: result.packageId ? await issueResolutionToken(ctx, 'package', String(result.packageId)) : null,
        payment_selection_token: result.paymentId ? await issueResolutionToken(ctx, 'payment', String(result.paymentId)) : null,
      }
    },
  },
  {
    name: 'carebook_record_refund',
    description: 'Record a refund against one selected payment. Target matching is internal and returns no billing history.',
    scope: 'write:billing',
    adminOnly: true,
    inputSchema: billingInputSchema({ patient_name: stringProp('Patient name unless a payment token is supplied'), patient_selection_token: stringProp('Opaque patient token'), payment_selection_token: stringProp('Opaque payment token'), payment_date: stringProp('Optional payment date selector'), amount: numberProp('Refund amount'), refund_method: enumProp('Refund method', [...PAYMENT_METHODS]), refund_date: stringProp('Refund date'), reason: stringProp('Audited reason') }, ['amount', 'refund_method', 'refund_date', 'reason']),
    handler: async (args, ctx) => {
      ensureKey(args)
      const target = await resolvePayment(ctx, args)
      if ('choice' in target) return target.choice
      const validated = validateReasonedMutation('record_refund', { entityId: target.id, amount: Number(args.amount), refundMethod: requirePaymentMethod(args, 'refund_method'), refundDate: text(args, 'refund_date'), reason: text(args, 'reason') })
      if (!validated.ok) failValidation(validated)
      if (!isConfirmed(args)) return dryRun('record_refund', { patient_name: text(args, 'patient_name'), amount: validated.summary.amount, refund_method: text(args, 'refund_method'), refund_date: text(args, 'refund_date') })
      await consumeTargetSelection(ctx, target)
      await consumePatientSelection(ctx, args, target.patientId)
      const result = await runRpc(ctx, validated.rpc, validated.params, 'Unable to record this refund.')
      if (result.refundId) ctx.auditEntity = { type: 'refund', id: String(result.refundId) }
      return { recorded: true, refund_recorded: Boolean(result.refundId) }
    },
  },
  {
    name: 'carebook_void_payment',
    description: 'Void one selected payment with an audited reason. Requires confirmation and idempotency.',
    scope: 'write:billing',
    adminOnly: true,
    inputSchema: billingInputSchema({ patient_name: stringProp('Patient name unless a payment token is supplied'), patient_selection_token: stringProp('Opaque patient token'), payment_selection_token: stringProp('Opaque payment token'), payment_date: stringProp('Optional payment date selector'), amount: numberProp('Optional amount selector'), reason: stringProp('Audited reason') }, ['reason']),
    handler: async (args, ctx) => {
      ensureKey(args)
      const target = await resolvePayment(ctx, args)
      if ('choice' in target) return target.choice
      const validated = validateReasonedMutation('void_payment', { entityId: target.id, reason: text(args, 'reason') })
      if (!validated.ok) failValidation(validated)
      if (!isConfirmed(args)) return dryRun('void_payment', { patient_name: text(args, 'patient_name'), reason: validated.summary.reason })
      await consumeTargetSelection(ctx, target)
      await consumePatientSelection(ctx, args, target.patientId)
      await runRpc(ctx, validated.rpc, validated.params, 'Unable to void this payment.')
      ctx.auditEntity = { type: 'payment', id: target.id }
      return { recorded: true }
    },
  },
  {
    name: 'carebook_cancel_package',
    description: 'Cancel one selected package with an audited reason. Its payments are voided with it (refused while a refund on them is unreversed). Package lists and balances are not exposed.',
    scope: 'write:billing',
    adminOnly: true,
    inputSchema: billingInputSchema({ patient_name: stringProp('Patient name unless a package token is supplied'), patient_selection_token: stringProp('Opaque patient token'), package_name: stringProp('Package name selector'), package_selection_token: stringProp('Opaque package token'), reason: stringProp('Audited reason') }, ['reason']),
    handler: async (args, ctx) => {
      ensureKey(args)
      const target = await resolvePackage(ctx, args)
      if ('choice' in target) return target.choice
      const validated = validateReasonedMutation('cancel_package', { entityId: target.id, reason: text(args, 'reason') })
      if (!validated.ok) failValidation(validated)
      if (!isConfirmed(args)) return dryRun('cancel_package', { patient_name: text(args, 'patient_name'), package_name: text(args, 'package_name'), reason: validated.summary.reason })
      await consumeTargetSelection(ctx, target)
      await consumePatientSelection(ctx, args, target.patientId)
      await runRpc(ctx, validated.rpc, validated.params, 'Unable to cancel this package.')
      ctx.auditEntity = { type: 'package', id: target.id }
      return { recorded: true }
    },
  },
  {
    name: 'carebook_adjust_appointment_fee',
    description: 'Adjust an appointment fee through the audited billing RPC. Appointment targeting uses a name/date/time selector or opaque token.',
    scope: 'write:billing',
    adminOnly: true,
    inputSchema: billingInputSchema({ patient_name: stringProp('Patient name unless an appointment token is supplied'), patient_selection_token: stringProp('Opaque patient token'), appointment_selection_token: stringProp('Opaque appointment token'), date: stringProp('Appointment date'), time: stringProp('Appointment time'), adjusted_amount: numberProp('New fee amount'), reason: stringProp('Audited reason') }, ['adjusted_amount', 'reason']),
    handler: async (args, ctx) => {
      ensureKey(args)
      const target = await resolveAppointmentTarget(ctx, args)
      if ('choice' in target) return target.choice
      const validated = validateReasonedMutation('adjust_appointment_fee', { entityId: target.id, adjustedAmount: Number(args.adjusted_amount), reason: text(args, 'reason') })
      if (!validated.ok) failValidation(validated)
      if (!isConfirmed(args)) return dryRun('adjust_appointment_fee', { patient_name: text(args, 'patient_name'), adjusted_amount: validated.summary.amount, reason: validated.summary.reason })
      await consumeTargetSelection(ctx, target)
      await consumePatientSelection(ctx, args, target.patientId)
      await runRpc(ctx, validated.rpc, validated.params, 'Unable to adjust this appointment fee.')
      ctx.auditEntity = { type: 'appointment', id: target.id }
      return { recorded: true }
    },
  },
]
