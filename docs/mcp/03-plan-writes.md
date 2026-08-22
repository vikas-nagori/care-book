# Care-Book MCP — Plan 2: Clinical and Billing Write Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an MCP agent create patients and appointments, and record billing through Care-Book's existing audited RPCs — without ever being able to bypass a guard the UI enforces. Session-note writes, patient updates, appointment rescheduling/cancellation, deletes, and billing reads remain excluded.

**Architecture:** The validation and RPC-parameter construction currently living inside `src/app/billing/actions.ts` is extracted into a client-agnostic module that both the server actions and the MCP tools call. The MCP path therefore cannot diverge from the UI path. Money-moving tools default to a dry run, require an explicit `confirm: true`, and require an `idempotency_key` enforced by a partial unique index.

**Tech Stack:** Same as Plan 1. No new dependencies.

**Spec:** `docs/mcp/01-design.md` §8.3, §8.4, §9

**Prerequisite:** Plan 1 is merged, deployed, and Chanakya has successfully connected and called `carebook_whoami` against production. Do not start this plan before that.

**Current implementation note:** The six billing tools are implemented in
`src/lib/mcp/tools/billing-writes.ts`. The clinical scope is limited to
`carebook_create_patient` and `carebook_create_appointment`; the older task
descriptions below that mention patient updates or session-note writes are
superseded by this contract.

## Global Constraints

Everything in Plan 1's Global Constraints still applies, plus:

- **No tool writes to a billing table directly.** Every money mutation goes through the existing `security definer` RPCs, which hold the locking, allocation and audit-ledger logic.
- **`p_funding_scope` is always `'ordinary'` and `p_package_id` is always `null`** for `record_payment_v2`. This is not a default an agent may override — see the comment at `src/app/billing/actions.ts:38`. A caller-supplied funding scope would let a partial receipt be booked against a package, stranding a due no screen can collect.
- **Packages are collected in full.** A `package_with_payment` entry whose amount differs from `sessions × per-session` by more than 0.005 is rejected before the RPC is called, exactly as the UI does.
- **Every reasoned mutation requires a non-empty `reason`.** Voids, cancellations, refunds and fee adjustments are audited; a blank reason is refused.
- **`confirm` defaults to `false`.** Without `confirm: true`, a money tool validates fully, returns a preview, writes nothing, and records `status: 'dry_run'`.
- **`idempotency_key` is required on every money tool.** A repeat of a key already recorded `ok` for that grant returns the stored result.
- **Deliberately excluded:** `delete_payment` and `delete_package`. Deletion stays a human action in the UI.

---

## File Structure

**New**

| File | Responsibility |
|---|---|
| `src/lib/billing/mutations.ts` | Client-agnostic billing validation + RPC dispatch, shared by server actions and MCP |
| `src/lib/billing/mutations.test.ts` | Validation unit tests |
| `src/lib/mcp/idempotency.ts` | Replay lookup and result recording |
| `src/lib/mcp/confirm.ts` | Dry-run envelope shared by every money tool |
| `src/lib/mcp/tools/patients.ts` | Name-based patient reads and creation |
| `src/lib/mcp/tools/appointments.ts` | Appointment/session reads and creation |
| `src/lib/mcp/tools/billing-writes.ts` | The six billing tools |

**Modified**

- `src/app/billing/actions.ts` — becomes a thin cookie-session wrapper over `src/lib/billing/mutations.ts`
- `src/app/api/mcp/route.ts` — register the new tool groups; enforce idempotency before dispatch
- `e2e/admin/`, `e2e/staff/` — write-flow coverage

---

## Task 1: Extract billing mutations into a shared, client-agnostic module

This is the task that makes the rest safe. Do it first and do not shortcut it — a parallel implementation of billing validation for MCP is how the two paths drift apart.

**Files:**
- Create: `src/lib/billing/mutations.ts`, `src/lib/billing/mutations.test.ts`
- Modify: `src/app/billing/actions.ts`

**Interfaces:**
- Produces:

```typescript
export type BillingRpcCaller = (name: string, params: Record<string, unknown>) => Promise<RpcResult>

export type ValidationFailure = { ok: false; errorCode: string; message: string }
export type ValidationSuccess<T> = { ok: true; rpc: string; params: Record<string, unknown>; summary: T }
export type Validated<T> = ValidationSuccess<T> | ValidationFailure

export function validateRecordPayment(input: RecordPaymentInput): Validated<PaymentSummary>
export function validateBillingEntry(input: CreateBillingEntryInput): Validated<EntrySummary>
export function validateReasonedMutation(kind: ReasonedKind, input: ReasonedInput): Validated<ReasonedSummary>
```

where

```typescript
export type PaymentSummary = { patientId: string; amount: number; method: string; date: string }
export type EntrySummary = {
  patientId: string
  mode: 'payment_only' | 'package_with_payment'
  packageName: string | null
  totalSessions: number | null
  packageTotal: number | null
  amount: number
  method: string
  date: string
}
export type ReasonedKind = 'void_payment' | 'cancel_package' | 'record_refund' | 'void_refund' | 'adjust_appointment_fee'
export type ReasonedSummary = { kind: ReasonedKind; entityId: string; reason: string; amount: number | null }
```

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/billing/mutations.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { validateBillingEntry, validateReasonedMutation, validateRecordPayment } from './mutations.ts'

test('a standalone payment is always ordinary-scoped with no package', () => {
  const result = validateRecordPayment({
    patientId: 'p1',
    amount: 500,
    paymentMethod: 'cash',
    date: '2026-08-15',
    notes: 'session fee',
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.rpc, 'record_payment_v2')
  assert.equal(result.params.p_funding_scope, 'ordinary')
  assert.equal(result.params.p_package_id, null)
  assert.equal(result.params.p_amount, 500)
})

test('a non-positive payment amount is refused', () => {
  for (const amount of [0, -1, Number.NaN]) {
    const result = validateRecordPayment({
      patientId: 'p1',
      amount,
      paymentMethod: 'cash',
      date: '2026-08-15',
      notes: null,
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.errorCode, 'PAYMENT_INVALID_AMOUNT')
  }
})

test('a payment with no patient is refused', () => {
  const result = validateRecordPayment({
    patientId: '',
    amount: 100,
    paymentMethod: 'cash',
    date: '2026-08-15',
    notes: null,
  })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.errorCode, 'PAYMENT_MISSING_PATIENT')
})

test('a package must be paid in full', () => {
  const base = {
    patientId: 'p1',
    mode: 'package_with_payment' as const,
    packageName: '10-session physio',
    packageTotalSessions: 10,
    packagePerSessionAmount: 500,
    appointmentTypeId: 'type-1',
    packageStartsOn: '2026-08-15',
    paymentMethod: 'cash',
    paymentDate: '2026-08-15',
    paymentNotes: 'package receipt',
  }

  const partial = validateBillingEntry({ ...base, paymentAmount: 3000 })
  assert.equal(partial.ok, false)
  if (partial.ok) return
  assert.equal(partial.errorCode, 'PACKAGE_PARTIAL_PAYMENT')

  const full = validateBillingEntry({ ...base, paymentAmount: 5000 })
  assert.equal(full.ok, true)
  if (!full.ok) return
  assert.equal(full.rpc, 'record_billing_entry_v2')
  assert.equal(full.summary.packageTotal, 5000)
})

test('a package entry missing its appointment type is refused', () => {
  const result = validateBillingEntry({
    patientId: 'p1',
    mode: 'package_with_payment',
    packageName: 'physio',
    packageTotalSessions: 10,
    packagePerSessionAmount: 500,
    appointmentTypeId: '',
    packageStartsOn: '2026-08-15',
    paymentAmount: 5000,
    paymentMethod: 'cash',
    paymentDate: '2026-08-15',
    paymentNotes: 'notes',
  })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.errorCode, 'PACKAGE_APPOINTMENT_TYPE_REQUIRED')
})

test('a reasoned mutation requires a non-empty reason', () => {
  const blank = validateReasonedMutation('void_payment', { entityId: 'pay-1', reason: '   ' })
  assert.equal(blank.ok, false)
  if (blank.ok) return
  assert.equal(blank.errorCode, 'BILLING_REASON_REQUIRED')

  const ok = validateReasonedMutation('void_payment', { entityId: 'pay-1', reason: 'Duplicate entry' })
  assert.equal(ok.ok, true)
  if (!ok.ok) return
  assert.equal(ok.rpc, 'void_payment')
  assert.equal(ok.params.p_reason, 'Duplicate entry')
})

test('a refund requires a positive amount, a method and a date', () => {
  const noMethod = validateReasonedMutation('record_refund', {
    entityId: 'pay-1',
    reason: 'Overcharged',
    amount: 500,
    refundMethod: '',
    refundDate: '2026-08-15',
  })
  assert.equal(noMethod.ok, false)
  if (noMethod.ok) return
  assert.equal(noMethod.errorCode, 'REFUND_METHOD_REQUIRED')
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/billing/mutations.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Move the validation bodies out of `src/app/billing/actions.ts` verbatim. Each validator returns either a failure or the exact `rpc` name and `params` object the action currently builds, plus a `summary` used for dry-run previews.

Key rules to preserve exactly, copied from the current actions:

- `validateRecordPayment` always sets `p_funding_scope: 'ordinary'` and `p_package_id: null`. There is no parameter for either. (Mirrors `src/app/billing/actions.ts:38`.)
- `validateBillingEntry` computes the package total with `calculatePackageTotal(totalSessions, perSessionAmount)` from `src/lib/billing/payment-helpers.ts` and rejects `Math.abs(paymentAmount - packageTotal) > 0.005`.
- `validateBillingEntry` requires, for `package_with_payment`: a non-blank name, an integer `> 0` session count, a finite `> 0` per-session amount, an `appointmentTypeId`, a `packageStartsOn`, and non-blank notes.
- `validateReasonedMutation` trims the reason and rejects a blank one for every kind, and additionally requires a positive amount, a method and a date for `record_refund`.
- The `rpc` names are exactly `record_payment_v2`, `record_billing_entry_v2`, `void_payment`, `cancel_package`, `record_refund`, `void_refund`, `adjust_appointment_fee`.

Add a shared dispatcher:

```typescript
// src/lib/billing/mutations.ts (dispatcher portion)
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../logger.ts'

export type RpcResult = Record<string, unknown> | null

export async function callBillingRpc(
  supabase: SupabaseClient,
  name: string,
  params: Record<string, unknown>,
  context: Record<string, unknown>
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(name, params)
  if (error) {
    logger.error(`billing/${name}`, error, context)
    return { success: false, errorCode: error.code ?? 'BILLING_MUTATION_FAILED', message: error.message }
  }
  return data as RpcResult
}
```

- [ ] **Step 4: Rewrite the server actions on top of it**

`src/app/billing/actions.ts` keeps its exported signatures unchanged — every existing caller and every existing test must continue to work. Each action now:

1. `requireBillingAdmin()`
2. calls the matching `validate*`
3. on failure returns `{ success: false, errorCode, message }` built from the validation failure
4. on success calls `callBillingRpc(await createClient(), rpc, params, context)`
5. handles the result and revalidates exactly as before

- [ ] **Step 5: Run every existing billing test**

```bash
node --test --experimental-strip-types src/lib/billing/mutations.test.ts
npm run test:unit && npm run test:integration && npm run test:component
```

Expected: the new tests pass **and** every pre-existing billing test still passes unchanged. If any existing test needed editing, the extraction changed behaviour — revert and redo it as a pure move.

- [ ] **Step 6: Commit**

```bash
npm run lint && npm run typecheck
git add src/lib/billing/mutations.ts src/lib/billing/mutations.test.ts src/app/billing/actions.ts
git commit -m "refactor(billing): extract client-agnostic billing validation and RPC dispatch"
```

---

## Task 2: Idempotency and dry-run helpers

**Files:**
- Create: `src/lib/mcp/idempotency.ts`
- Create: `src/lib/mcp/confirm.ts`, `src/lib/mcp/confirm.test.ts`
- Test: `test/integration/mcp-idempotency.test.ts`

**Interfaces:**
- Consumes: `ResolvedGrant` (Plan 1 Task 5), `ToolError` (Plan 1 Task 11)
- Produces:
  - `findReplay(grantId: string, idempotencyKey: string): Promise<{ entityType: string | null; entityId: string | null } | null>`
  - `requireIdempotencyKey(args: Record<string, unknown>): string`
  - `isConfirmed(args: Record<string, unknown>): boolean`
  - `dryRun(action: string, summary: Record<string, unknown>): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/mcp/confirm.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { dryRun, isConfirmed, requireIdempotencyKey } from './confirm.ts'

test('confirmation must be the literal boolean true', () => {
  assert.equal(isConfirmed({ confirm: true }), true)
  assert.equal(isConfirmed({ confirm: 'true' }), false)
  assert.equal(isConfirmed({ confirm: 1 }), false)
  assert.equal(isConfirmed({}), false)
})

test('an idempotency key is required and bounded', () => {
  assert.equal(requireIdempotencyKey({ idempotency_key: 'abc-123' }), 'abc-123')
  assert.throws(() => requireIdempotencyKey({}), /idempotency_key/)
  assert.throws(() => requireIdempotencyKey({ idempotency_key: '   ' }), /idempotency_key/)
  assert.throws(() => requireIdempotencyKey({ idempotency_key: 'x'.repeat(200) }), /idempotency_key/)
})

test('a dry run is clearly labelled and states nothing was written', () => {
  const preview = dryRun('record_payment', { amount: 2000 })
  assert.equal(preview.dry_run, true)
  assert.equal(preview.written, false)
  assert.equal(preview.action, 'record_payment')
  assert.match(String(preview.next_step), /confirm/)
  assert.deepEqual(preview.would, { amount: 2000 })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/confirm.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the confirm helpers**

```typescript
// src/lib/mcp/confirm.ts
import { ToolError } from './errors.ts'

// Strict boolean only. A model that emits the string "true" has not made a
// deliberate confirmation, and coercing it would defeat the whole checkpoint.
export function isConfirmed(args: Record<string, unknown>): boolean {
  return args.confirm === true
}

export function requireIdempotencyKey(args: Record<string, unknown>): string {
  const raw = typeof args.idempotency_key === 'string' ? args.idempotency_key.trim() : ''
  if (!raw || raw.length > 128) {
    throw new ToolError('idempotency_key is required and must be 1–128 characters.')
  }
  return raw
}

export function dryRun(action: string, summary: Record<string, unknown>): Record<string, unknown> {
  return {
    dry_run: true,
    written: false,
    action,
    would: summary,
    next_step:
      'Show this to the user. If they agree, call the same tool again with confirm: true and the same idempotency_key.',
  }
}
```

- [ ] **Step 4: Write the idempotency store**

```typescript
// src/lib/mcp/idempotency.ts
import 'server-only'

import { createAdminClient } from '../supabase/admin.ts'

export async function findReplay(
  grantId: string,
  idempotencyKey: string
): Promise<{ entityType: string | null; entityId: string | null; toolName: string } | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('mcp_tool_invocations')
    .select('tool_name, entity_type, entity_id')
    .eq('grant_id', grantId)
    .eq('idempotency_key', idempotencyKey)
    .eq('status', 'ok')
    .limit(1)

  const row = data?.[0]
  if (!row) return null
  return { toolName: row.tool_name, entityType: row.entity_type, entityId: row.entity_id }
}
```

- [ ] **Step 5: Write the idempotency integration test**

```typescript
// test/integration/mcp-idempotency.test.ts
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, run, seedUser } from './db.ts'

const DB = 'carebook_it_mcp_idempotency'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let adminId = ''
let grantId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Idem Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  run(
    DB,
    `insert into mcp_oauth_clients (client_id, redirect_uris)
     values ('cbk_client_idem', array['https://example.test/cb'])`
  )
  grantId = query(
    DB,
    `insert into mcp_access_grants
       (user_id, clinic_id, client_id, scopes, resource, access_token_hash, access_expires_at)
     values ('${adminId}', '${clinicId}', 'cbk_client_idem', array['read','write:billing'],
             'https://example.test/api/mcp', 'at-idem', now() + interval '1 hour')
     returning id`
  )
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function invoke(key: string, status: string): void {
  run(
    DB,
    `insert into mcp_tool_invocations
       (grant_id, user_id, clinic_id, tool_name, idempotency_key, request_digest, status)
     values ('${grantId}', '${adminId}', '${clinicId}', 'carebook_record_payment',
             '${key}', 'digest', '${status}')`
  )
}

test('a second successful call with the same key is rejected by the database', { skip }, () => {
  invoke('dup-key', 'ok')
  assert.throws(() => invoke('dup-key', 'ok'))
})

test('a dry run does not consume the key', { skip }, () => {
  invoke('preview-key', 'dry_run')
  invoke('preview-key', 'ok')
  assert.equal(
    query(DB, `select count(*) from mcp_tool_invocations where idempotency_key = 'preview-key'`),
    '2'
  )
})

test('a failed attempt does not consume the key', { skip }, () => {
  invoke('retry-key', 'error')
  invoke('retry-key', 'ok')
  assert.equal(
    query(
      DB,
      `select count(*) from mcp_tool_invocations where idempotency_key = 'retry-key' and status = 'ok'`
    ),
    '1'
  )
})
```

- [ ] **Step 6: Run and commit**

```bash
node --test --experimental-strip-types src/lib/mcp/confirm.test.ts
node --test --experimental-strip-types test/integration/mcp-idempotency.test.ts
npm run lint && npm run typecheck
```

```bash
git add src/lib/mcp/confirm.ts src/lib/mcp/confirm.test.ts src/lib/mcp/idempotency.ts test/integration/mcp-idempotency.test.ts
git commit -m "feat(mcp): add dry-run confirmation and idempotency-key helpers"
```

---

## Task 3: Patient write tools

**Files:**
- Create: `src/lib/mcp/tools/patient-writes.ts`, `src/lib/mcp/tools/patient-writes.test.ts`
- Modify: `src/app/api/mcp/route.ts`

**Interfaces:**
- Produces: `patientWriteTools: McpToolDefinition[]` — `carebook_create_patient`, `carebook_update_patient`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/mcp/tools/patient-writes.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizePatientInput, patientWriteTools } from './patient-writes.ts'

test('a patient needs a name and a phone number', () => {
  assert.throws(() => normalizePatientInput({ name: '', phone: '9876543210' }), /name/)
  assert.throws(() => normalizePatientInput({ name: 'Priya', phone: '' }), /phone/)
})

test('whitespace is trimmed and blank optionals become null', () => {
  const normalized = normalizePatientInput({
    name: '  Priya Sharma ',
    phone: ' 9876543210 ',
    email: '   ',
    notes: 'referred by Dr Rao',
  })
  assert.equal(normalized.name, 'Priya Sharma')
  assert.equal(normalized.phone, '9876543210')
  assert.equal(normalized.email, null)
  assert.equal(normalized.notes, 'referred by Dr Rao')
})

test('a malformed date of birth is refused', () => {
  assert.throws(() => normalizePatientInput({ name: 'A', phone: '1', dob: '15-08-1990' }), /dob/)
})

test('patient write tools carry the clinical scope', () => {
  for (const tool of patientWriteTools) assert.equal(tool.scope, 'write:clinical')
  assert.deepEqual(patientWriteTools.map((tool) => tool.name), [
    'carebook_create_patient',
    'carebook_update_patient',
  ])
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/tools/patient-writes.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the tools**

```typescript
// src/lib/mcp/tools/patient-writes.ts
import { ToolError } from '../errors.ts'
import type { McpToolDefinition } from '../registry.ts'
import { objectSchema, stringProp } from '../schema.ts'
import { isIsoDate } from './appointments.ts'

export type NormalizedPatient = {
  name: string
  phone: string
  email: string | null
  dob: string | null
  gender: string | null
  address: string | null
  medical_history: string | null
  notes: string | null
}

function optional(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === '' ? null : text
}

export function normalizePatientInput(args: Record<string, unknown>): NormalizedPatient {
  const name = typeof args.name === 'string' ? args.name.trim() : ''
  const phone = typeof args.phone === 'string' ? args.phone.trim() : ''
  if (!name) throw new ToolError('name is required')
  if (!phone) throw new ToolError('phone is required')

  const dob = optional(args.dob)
  if (dob && !isIsoDate(dob)) throw new ToolError('dob must be yyyy-MM-dd')

  return {
    name,
    phone,
    email: optional(args.email),
    dob,
    gender: optional(args.gender),
    address: optional(args.address),
    medical_history: optional(args.medical_history),
    notes: optional(args.notes),
  }
}

export const patientWriteTools: McpToolDefinition[] = [
  {
    name: 'carebook_create_patient',
    description:
      'Create a new patient in this clinic. Search first with carebook_search_patients — creating a duplicate patient splits their billing history. Returns the new patient id.',
    scope: 'write:clinical',
    inputSchema: objectSchema(
      {
        name: stringProp('Full name'),
        phone: stringProp('Contact phone number'),
        email: stringProp('Optional email address'),
        dob: stringProp('Optional date of birth as yyyy-MM-dd'),
        gender: stringProp('Optional gender'),
        address: stringProp('Optional address'),
        medical_history: stringProp('Optional medical history'),
        notes: stringProp('Optional notes'),
      },
      ['name', 'phone']
    ),
    handler: async (args, ctx) => {
      const patient = normalizePatientInput(args)
      // clinic_id is set by the set_patient_clinic_id trigger from auth.uid(),
      // so it is deliberately not sent from here.
      const { data, error } = await ctx.supabase
        .from('patients')
        .insert(patient)
        .select('id, name, phone')
        .single()
      if (error) throw error
      return { created: true, patient: data }
    },
  },
  {
    name: 'carebook_update_patient',
    description:
      'Update an existing patient\'s details. Only the fields you pass are changed. Returns the updated record.',
    scope: 'write:clinical',
    inputSchema: objectSchema(
      {
        patient_id: stringProp('Patient UUID'),
        name: stringProp('Full name'),
        phone: stringProp('Contact phone number'),
        email: stringProp('Email address'),
        dob: stringProp('Date of birth as yyyy-MM-dd'),
        gender: stringProp('Gender'),
        address: stringProp('Address'),
        medical_history: stringProp('Medical history'),
        notes: stringProp('Notes'),
      },
      ['patient_id']
    ),
    handler: async (args, ctx) => {
      const patientId = String(args.patient_id ?? '')
      if (!patientId) throw new ToolError('patient_id is required')

      const patch: Record<string, unknown> = {}
      for (const field of ['name', 'phone', 'email', 'dob', 'gender', 'address', 'medical_history', 'notes']) {
        if (args[field] !== undefined) patch[field] = optional(args[field])
      }
      if (typeof patch.name === 'object' && patch.name === null) throw new ToolError('name cannot be blanked')
      if (typeof patch.phone === 'object' && patch.phone === null) throw new ToolError('phone cannot be blanked')
      if (patch.dob && !isIsoDate(String(patch.dob))) throw new ToolError('dob must be yyyy-MM-dd')
      if (Object.keys(patch).length === 0) throw new ToolError('Pass at least one field to update')

      const { data, error } = await ctx.supabase
        .from('patients')
        .update(patch)
        .eq('id', patientId)
        .select('id, name, phone')
        .maybeSingle()
      if (error) throw error
      if (!data) throw new ToolError('No patient with that id is visible to you.')
      return { updated: true, patient: data }
    },
  },
]
```

**Verify before running:** confirm the `set_patient_clinic_id` trigger populates `clinic_id` on insert (it appears in the RPC list). If it does not, add `clinic_id: ctx.profile.clinic_id` to the insert.

- [ ] **Step 4: Register, run and commit**

Add `...patientWriteTools` to `createRegistry([...])` in `src/app/api/mcp/route.ts`.

```bash
node --test --experimental-strip-types src/lib/mcp/tools/patient-writes.test.ts
npm run lint && npm run typecheck
```

```bash
git add src/lib/mcp/tools/patient-writes.ts src/lib/mcp/tools/patient-writes.test.ts src/app/api/mcp/route.ts
git commit -m "feat(mcp): add patient create and update tools"
```

---

## Task 4: Appointment and session-note write tools

**Files:**
- Create: `src/lib/mcp/tools/appointment-writes.ts`, `src/lib/mcp/tools/appointment-writes.test.ts`
- Create: `src/lib/mcp/tools/clinical-writes.ts`
- Modify: `src/app/api/mcp/route.ts`
- Test: `test/integration/mcp-write-guards.test.ts`

**Interfaces:**
- Produces: `appointmentWriteTools` — `carebook_create_appointment`, `carebook_reschedule_appointment`, `carebook_cancel_appointment`; `clinicalWriteTools` — `carebook_upsert_session_note`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/mcp/tools/appointment-writes.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { appointmentWriteTools, isIsoTime, normalizeDuration } from './appointment-writes.ts'

test('times must be 24-hour HH:mm', () => {
  assert.equal(isIsoTime('09:30'), true)
  assert.equal(isIsoTime('23:59'), true)
  assert.equal(isIsoTime('9:30'), false)
  assert.equal(isIsoTime('24:00'), false)
  assert.equal(isIsoTime('09:60'), false)
  assert.equal(isIsoTime(''), false)
})

test('duration defaults to 45 minutes and is bounded', () => {
  assert.equal(normalizeDuration(undefined), 45)
  assert.equal(normalizeDuration(30), 30)
  assert.equal(normalizeDuration(0), 45)
  assert.equal(normalizeDuration(1000), 480)
})

test('appointment write tools carry the clinical scope', () => {
  for (const tool of appointmentWriteTools) assert.equal(tool.scope, 'write:clinical')
  assert.deepEqual(appointmentWriteTools.map((tool) => tool.name), [
    'carebook_create_appointment',
    'carebook_reschedule_appointment',
    'carebook_cancel_appointment',
  ])
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/tools/appointment-writes.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the appointment tools**

```typescript
// src/lib/mcp/tools/appointment-writes.ts
import { ToolError } from '../errors.ts'
import type { McpToolDefinition } from '../registry.ts'
import { numberProp, objectSchema, stringProp } from '../schema.ts'
import { isIsoDate } from './appointments.ts'

export function isIsoTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function normalizeDuration(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value) || value < 5) return 45
  return Math.min(Math.floor(value), 480)
}

export const appointmentWriteTools: McpToolDefinition[] = [
  {
    name: 'carebook_create_appointment',
    description:
      'Book an appointment. Dates are yyyy-MM-dd and times are 24-hour HH:mm in India Standard Time. Get appointment_type_id from carebook_list_appointment_types and assigned_to from carebook_list_staff.',
    scope: 'write:clinical',
    inputSchema: objectSchema(
      {
        patient_id: stringProp('Patient UUID'),
        appointment_type_id: stringProp('Appointment type UUID'),
        date: stringProp('Date as yyyy-MM-dd'),
        time: stringProp('Start time as 24-hour HH:mm'),
        duration_minutes: numberProp('Duration in minutes. Default 45, maximum 480'),
        assigned_to: stringProp('Optional staff profile UUID to assign'),
        notes: stringProp('Optional notes'),
      },
      ['patient_id', 'appointment_type_id', 'date', 'time']
    ),
    handler: async (args, ctx) => {
      const date = String(args.date ?? '')
      const time = String(args.time ?? '')
      if (!isIsoDate(date)) throw new ToolError('date must be yyyy-MM-dd')
      if (!isIsoTime(time)) throw new ToolError('time must be 24-hour HH:mm')

      const typeId = String(args.appointment_type_id ?? '')
      const { data: type } = await ctx.supabase
        .from('appointment_types')
        .select('id, name, is_shared, default_fee')
        .eq('id', typeId)
        .maybeSingle()
      if (!type) throw new ToolError('No appointment type with that id is visible to you.')

      // `type` and `type_is_shared` are denormalized copies the schedule view
      // reads without a join; they must stay consistent with the type row.
      const { data, error } = await ctx.supabase
        .from('appointments')
        .insert({
          patient_id: String(args.patient_id ?? ''),
          appointment_type_id: type.id,
          type: type.name,
          type_is_shared: type.is_shared,
          date,
          time,
          duration_minutes: normalizeDuration(args.duration_minutes),
          status: 'scheduled',
          assigned_to: args.assigned_to ? String(args.assigned_to) : null,
          notes: typeof args.notes === 'string' ? args.notes.trim() || null : null,
        })
        .select('id, date, time, type, status')
        .single()
      if (error) throw error
      return { created: true, appointment: data }
    },
  },
  {
    name: 'carebook_reschedule_appointment',
    description:
      'Move a scheduled appointment to a new date and/or time. Does not change its fee or payment status.',
    scope: 'write:clinical',
    inputSchema: objectSchema(
      {
        appointment_id: stringProp('Appointment UUID'),
        date: stringProp('New date as yyyy-MM-dd'),
        time: stringProp('New start time as 24-hour HH:mm'),
        duration_minutes: numberProp('New duration in minutes'),
      },
      ['appointment_id']
    ),
    handler: async (args, ctx) => {
      const patch: Record<string, unknown> = {}
      if (args.date !== undefined) {
        const date = String(args.date)
        if (!isIsoDate(date)) throw new ToolError('date must be yyyy-MM-dd')
        patch.date = date
      }
      if (args.time !== undefined) {
        const time = String(args.time)
        if (!isIsoTime(time)) throw new ToolError('time must be 24-hour HH:mm')
        patch.time = time
      }
      if (args.duration_minutes !== undefined) {
        patch.duration_minutes = normalizeDuration(args.duration_minutes)
      }
      if (Object.keys(patch).length === 0) throw new ToolError('Pass date, time or duration_minutes')

      const { data, error } = await ctx.supabase
        .from('appointments')
        .update(patch)
        .eq('id', String(args.appointment_id ?? ''))
        .eq('status', 'scheduled')
        .select('id, date, time, duration_minutes, status')
        .maybeSingle()
      if (error) throw error
      if (!data) throw new ToolError('No scheduled appointment with that id is visible to you.')
      return { rescheduled: true, appointment: data }
    },
  },
  {
    name: 'carebook_cancel_appointment',
    description:
      'Cancel a scheduled appointment. Billing already tallied against it is reversed by the database. This does not delete the appointment.',
    scope: 'write:clinical',
    inputSchema: objectSchema(
      { appointment_id: stringProp('Appointment UUID'), reason: stringProp('Optional cancellation note') },
      ['appointment_id']
    ),
    handler: async (args, ctx) => {
      const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
      const { data, error } = await ctx.supabase
        .from('appointments')
        .update({ status: 'cancelled', ...(reason ? { notes: reason } : {}) })
        .eq('id', String(args.appointment_id ?? ''))
        .eq('status', 'scheduled')
        .select('id, status')
        .maybeSingle()
      if (error) throw error
      if (!data) throw new ToolError('No scheduled appointment with that id is visible to you.')
      return { cancelled: true, appointment: data }
    },
  },
]
```

**Verify before running:** check `appointment_types` column names (`is_shared`, `default_fee`) and confirm the `set_appointment_creator` trigger sets `created_by` and `clinic_id` from `auth.uid()`. If it does not, set them explicitly from `ctx.profile`.

- [ ] **Step 4: Write the session-note tool**

```typescript
// src/lib/mcp/tools/clinical-writes.ts
import { ToolError } from '../errors.ts'
import type { McpToolDefinition } from '../registry.ts'
import { objectSchema, stringProp } from '../schema.ts'

export const clinicalWriteTools: McpToolDefinition[] = [
  {
    name: 'carebook_upsert_session_note',
    description:
      'Create or replace the SOAP session note attached to one appointment. Passing a field replaces it; omitting a field leaves it unchanged on an existing note.',
    scope: 'write:clinical',
    inputSchema: objectSchema(
      {
        appointment_id: stringProp('Appointment UUID'),
        subjective: stringProp('S — what the patient reports'),
        objective: stringProp('O — measurable findings'),
        assessment: stringProp('A — clinical assessment'),
        plan: stringProp('P — plan for next sessions'),
        exercises_prescribed: stringProp('Exercises prescribed'),
      },
      ['appointment_id']
    ),
    handler: async (args, ctx) => {
      const appointmentId = String(args.appointment_id ?? '')
      if (!appointmentId) throw new ToolError('appointment_id is required')

      // Read through the user's client first: if RLS hides the appointment,
      // the note must not be created either.
      const { data: appointment } = await ctx.supabase
        .from('appointments')
        .select('id')
        .eq('id', appointmentId)
        .maybeSingle()
      if (!appointment) throw new ToolError('No appointment with that id is visible to you.')

      const fields = ['subjective', 'objective', 'assessment', 'plan', 'exercises_prescribed'] as const
      const patch: Record<string, unknown> = { appointment_id: appointmentId }
      for (const field of fields) {
        if (args[field] !== undefined) {
          const text = typeof args[field] === 'string' ? String(args[field]).trim() : ''
          patch[field] = text === '' ? null : text
        }
      }
      if (Object.keys(patch).length === 1) throw new ToolError('Pass at least one SOAP field')

      const { data, error } = await ctx.supabase
        .from('session_notes')
        .upsert(patch, { onConflict: 'appointment_id' })
        .select('id, appointment_id, created_at')
        .single()
      if (error) throw error
      return { saved: true, session_note: data }
    },
  },
]
```

**Verify before running:** `session_notes.appointment_id` must carry a unique constraint for `onConflict` to work. If it does not, replace the upsert with a select-then-insert-or-update.

- [ ] **Step 5: Write the write-guard integration test**

```typescript
// test/integration/mcp-write-guards.test.ts
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAs, seedUser } from './db.ts'

const DB = 'carebook_it_mcp_write_guards'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let otherClinicId = ''
let adminId = ''
let staffId = ''
let otherAdminId = ''
let patientId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Guard Clinic') returning id`)
  otherClinicId = query(DB, `insert into clinics (name) values ('Other Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  staffId = seedUser(DB, 'staff', clinicId)
  otherAdminId = seedUser(DB, 'admin', otherClinicId)
  patientId = query(
    DB,
    `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'Guard Patient', '1') returning id`
  )
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

test('an admin from another clinic cannot update this clinic\'s patient', { skip }, () => {
  queryAs(DB, otherAdminId, `update patients set notes = 'tampered' where id = '${patientId}'`)
  assert.equal(query(DB, `select coalesce(notes, '') from patients where id = '${patientId}'`), '')
})

test('a staff member cannot record a payment', { skip }, () => {
  assert.throws(() =>
    queryAs(
      DB,
      staffId,
      `select record_payment_v2('${patientId}', 'ordinary', null, 500, 'cash', current_date, 'note')`
    )
  )
})

test('an admin can record a payment', { skip }, () => {
  const result = JSON.parse(
    queryAs(
      DB,
      adminId,
      `select record_payment_v2('${patientId}', 'ordinary', null, 500, 'cash', current_date, 'note')`
    )
  )
  assert.equal(result.success, true)
})
```

- [ ] **Step 6: Register, run and commit**

Add `...appointmentWriteTools, ...clinicalWriteTools` to `createRegistry([...])`.

```bash
node --test --experimental-strip-types src/lib/mcp/tools/appointment-writes.test.ts
node --test --experimental-strip-types test/integration/mcp-write-guards.test.ts
npm run lint && npm run typecheck && npm run build
```

```bash
git add src/lib/mcp/tools/appointment-writes.ts src/lib/mcp/tools/appointment-writes.test.ts src/lib/mcp/tools/clinical-writes.ts test/integration/mcp-write-guards.test.ts src/app/api/mcp/route.ts
git commit -m "feat(mcp): add appointment and session-note write tools"
```

---

## Task 5: Billing write tools

**Files:**
- Create: `src/lib/mcp/tools/billing-writes.ts`, `src/lib/mcp/tools/billing-writes.test.ts`
- Modify: `src/app/api/mcp/route.ts`

**Interfaces:**
- Consumes: `validateRecordPayment`, `validateBillingEntry`, `validateReasonedMutation`, `callBillingRpc` (Task 1); `isConfirmed`, `requireIdempotencyKey`, `dryRun` (Task 2)
- Produces: `billingWriteTools: McpToolDefinition[]` — six tools, all `scope: 'write:billing'`, all `adminOnly: true`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/mcp/tools/billing-writes.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { billingWriteTools } from './billing-writes.ts'

test('every billing write tool is admin-only and billing-scoped', () => {
  for (const tool of billingWriteTools) {
    assert.equal(tool.scope, 'write:billing')
    assert.equal(tool.adminOnly, true)
  }
})

test('every billing write tool requires confirm and idempotency_key in its schema', () => {
  for (const tool of billingWriteTools) {
    const schema = tool.inputSchema as { properties: Record<string, unknown>; required: string[] }
    assert.ok(schema.properties.confirm, `${tool.name} must expose confirm`)
    assert.ok(schema.properties.idempotency_key, `${tool.name} must expose idempotency_key`)
    assert.ok(
      schema.required.includes('idempotency_key'),
      `${tool.name} must require idempotency_key`
    )
  }
})

test('every billing write tool tells the model that confirm is required', () => {
  for (const tool of billingWriteTools) {
    assert.match(tool.description, /confirm/i, `${tool.name} description must mention confirm`)
  }
})

test('the tool names are stable', () => {
  assert.deepEqual(billingWriteTools.map((tool) => tool.name), [
    'carebook_record_payment',
    'carebook_record_billing_entry',
    'carebook_record_refund',
    'carebook_void_payment',
    'carebook_cancel_package',
    'carebook_adjust_appointment_fee',
  ])
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/tools/billing-writes.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the shared money-tool wrapper**

```typescript
// src/lib/mcp/tools/billing-writes.ts
import {
  callBillingRpc,
  validateBillingEntry,
  validateReasonedMutation,
  validateRecordPayment,
  type Validated,
} from '../../billing/mutations.ts'
import { dryRun, isConfirmed, requireIdempotencyKey } from '../confirm.ts'
import { ToolError } from '../errors.ts'
import type { McpToolDefinition, ToolContext } from '../registry.ts'
import { boolProp, numberProp, objectSchema, stringProp } from '../schema.ts'

// Every money tool follows the same shape: validate, preview unless confirmed,
// then dispatch to the audited RPC. Sharing it means a new billing tool cannot
// accidentally skip the confirmation checkpoint.
async function runMoneyTool<T extends Record<string, unknown>>(
  action: string,
  validated: Validated<T>,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<Record<string, unknown>> {
  requireIdempotencyKey(args)
  if (!validated.ok) throw new ToolError(validated.message)

  if (!isConfirmed(args)) {
    return dryRun(action, validated.summary as Record<string, unknown>)
  }

  const result = await callBillingRpc(ctx.supabase, validated.rpc, validated.params, {
    tool: action,
    userId: ctx.profile.id,
  })
  if (!result || result.success !== true) {
    throw new ToolError(
      typeof result?.message === 'string' ? result.message : 'The billing operation failed.'
    )
  }
  return { written: true, action, result }
}

const CONFIRM_PROPS = {
  confirm: boolProp('Set to true to actually write. Omit or set false to preview without writing.'),
  idempotency_key: stringProp(
    'A unique key for this operation. Reuse the same key when confirming a preview, and on any retry, so the amount cannot be recorded twice.'
  ),
}
```

- [ ] **Step 4: Write the six tools**

Each entry in `billingWriteTools` follows this pattern. `carebook_record_payment` in full:

```typescript
export const billingWriteTools: McpToolDefinition[] = [
  {
    name: 'carebook_record_payment',
    description:
      'Record a standalone payment received from a patient. Call once without confirm to preview what will be recorded, show that to the user, then call again with confirm: true and the same idempotency_key. Amounts are in INR.',
    scope: 'write:billing',
    adminOnly: true,
    inputSchema: objectSchema(
      {
        patient_id: stringProp('Patient UUID'),
        amount: numberProp('Amount received, greater than zero'),
        payment_method: stringProp('How the payment was received, e.g. cash, upi, card'),
        payment_date: stringProp('Date received as yyyy-MM-dd'),
        notes: stringProp('Optional notes for the receipt'),
        ...CONFIRM_PROPS,
      },
      ['patient_id', 'amount', 'payment_method', 'payment_date', 'idempotency_key']
    ),
    handler: async (args, ctx) =>
      runMoneyTool(
        'record_payment',
        validateRecordPayment({
          patientId: String(args.patient_id ?? ''),
          amount: Number(args.amount),
          paymentMethod: String(args.payment_method ?? ''),
          date: String(args.payment_date ?? ''),
          notes: typeof args.notes === 'string' ? args.notes : null,
        }),
        args,
        ctx
      ),
  },
  // …five more, listed below
]
```

The remaining five, each built the same way:

| Tool | Validator call | Required inputs beyond `idempotency_key` |
|---|---|---|
| `carebook_record_billing_entry` | `validateBillingEntry({ patientId, mode, packageName, packageTotalSessions, packagePerSessionAmount, appointmentTypeId, packageStartsOn, paymentAmount, paymentMethod, paymentDate, paymentNotes })` | `patient_id`, `mode`, `payment_amount`, `payment_method`, `payment_date` |
| `carebook_record_refund` | `validateReasonedMutation('record_refund', { entityId: payment_id, reason, amount, refundMethod, refundDate })` | `payment_id`, `amount`, `refund_method`, `refund_date`, `reason` |
| `carebook_void_payment` | `validateReasonedMutation('void_payment', { entityId: payment_id, reason })` | `payment_id`, `reason` |
| `carebook_cancel_package` | `validateReasonedMutation('cancel_package', { entityId: package_id, reason })` | `package_id`, `reason` |
| `carebook_adjust_appointment_fee` | `validateReasonedMutation('adjust_appointment_fee', { entityId: appointment_id, reason, amount: adjusted_amount })` | `appointment_id`, `adjusted_amount`, `reason` |

`mode` is an `enumProp('What to create', ['payment_only', 'package_with_payment'])`. Each description must state that a package is collected in full, that `reason` is recorded in the audit ledger, and that `confirm` is required.

- [ ] **Step 5: Enforce idempotency replay in the route**

In `src/app/api/mcp/route.ts`, before dispatching a `write:billing` tool:

```typescript
        if (tool.scope === 'write:billing' && isConfirmed(args)) {
          const key = requireIdempotencyKey(args)
          const replay = await findReplay(grant.grantId, key)
          if (replay) {
            return NextResponse.json(
              rpcResult(
                id,
                toolResult(
                  JSON.stringify(
                    {
                      written: false,
                      replayed: true,
                      message:
                        'This idempotency_key was already used successfully. Nothing was recorded twice.',
                      original: replay,
                    },
                    null,
                    2
                  )
                )
              )
            )
          }
        }
```

and pass the key plus the resulting entity into `recordInvocation` so the next replay can return it:

```typescript
          await recordInvocation({
            grant,
            toolName: tool.name,
            status: isConfirmed(args) ? 'ok' : 'dry_run',
            requestDigest,
            idempotencyKey: typeof args.idempotency_key === 'string' ? args.idempotency_key : null,
            entityType: tool.scope === 'write:billing' ? 'billing' : null,
            entityId: extractEntityId(value),
            durationMs: Date.now() - started,
          })
```

Add a small `extractEntityId(value: unknown): string | null` helper in `src/lib/mcp/audit.ts` that reads `paymentId`, `packageId`, `refundId`, `adjustmentId` or `appointmentId` off the RPC result, returning the first present one.

- [ ] **Step 6: Register, run and commit**

Add `...billingWriteTools` to `createRegistry([...])`.

```bash
node --test --experimental-strip-types src/lib/mcp/tools/billing-writes.test.ts
npm run test:unit && npm run test:integration
npm run lint && npm run typecheck && npm run build
```

```bash
git add src/lib/mcp/tools/billing-writes.ts src/lib/mcp/tools/billing-writes.test.ts src/lib/mcp/audit.ts src/app/api/mcp/route.ts
git commit -m "feat(mcp): add billing write tools with dry-run confirmation and idempotency"
```

---

## Task 6: End-to-end write coverage

**Files:**
- Create: `e2e/admin/mcp-writes.spec.ts`
- Modify: `e2e/admin/mcp-consent.spec.ts` (extend for write scopes)

- [ ] **Step 1: Write the spec**

Using the admin `storageState`, drive a full OAuth flow via `request` to obtain a real access token, then exercise the MCP endpoint directly:

1. Register a client, complete consent with `scope=read write:clinical write:billing`, exchange the code for a token
2. `tools/list` — assert the billing write tools are present for the admin grant
3. `carebook_create_patient` → capture the new `patient_id`
4. `carebook_record_payment` **without** `confirm` → assert `dry_run: true`, `written: false`, and that no `payments` row exists
5. The same call **with** `confirm: true` and the same `idempotency_key` → assert `written: true`
6. The identical call a third time → assert `replayed: true` and that exactly one payment exists
7. Repeat step 2 with a **staff** grant → assert the billing write tools are absent from `tools/list`, and that calling `carebook_record_payment` by name returns `isError: true`

Step 7 is the important one: it proves that hiding a tool and refusing it are both enforced, so a model that guesses a tool name it never saw still gets nothing.

- [ ] **Step 2: Run the full suite**

```bash
npm run e2e:db:up && npm run build:e2e && npm run test:e2e
```

Expected: all shards green.

- [ ] **Step 3: Commit and push**

```bash
git add e2e
git commit -m "test(mcp): cover the dry-run, confirm and replay path for billing writes"
git push
```

Watch the GitHub Actions run to completion and report the conclusion.

---

## Task 7: Staged rollout

Writes to an audited financial ledger get a staged rollout, not a single flip.

- [ ] **Step 1: Ship with clinical writes only**

Deploy with the billing write tools registered but the `write:billing` checkbox hidden on the consent screen behind an env flag:

```
MCP_BILLING_WRITES_ENABLED=false
```

When false, `write:billing` is not offered at consent and is stripped from any grant that somehow carries it.

- [ ] **Step 2: Run the clinical writes for a week**

Watch `mcp_tool_invocations` for the rate of `error` and `denied` statuses and for anything unexpected in `tool_name`:

```sql
select tool_name, status, count(*)
from mcp_tool_invocations
where created_at > now() - interval '7 days'
group by 1, 2
order by 3 desc;
```

- [ ] **Step 3: Enable billing writes**

Flip `MCP_BILLING_WRITES_ENABLED` to `true`. Existing grants do **not** gain the scope — each user must re-consent, which is the correct behaviour: nobody acquires a billing-write link without having seen and ticked that box.

- [ ] **Step 4: Verify the first real billing write end to end**

Have an agent record a small real payment. Then confirm, in the database:

- the `payments` row exists with `created_by` set to the consenting user and `creation_origin = 'rpc'`
- a matching `mcp_tool_invocations` row exists with `status = 'ok'` and the idempotency key
- the audit-ledger event from migration 031/032 was written

- [ ] **Step 5: Record the outcome**

Update the spec's status and note the rollout dates.

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §8.3 clinical writes | 3, 4 |
| §8.4 billing writes | 5 |
| §9 layer 1 — scope | 5 (`adminOnly` + `write:billing`), 7 (consent gating) |
| §9 layer 2 — dry run | 2, 5 |
| §9 layer 3 — idempotency | 2, 5 |
| §9 layer 4 — audit | 5 (`extractEntityId`, `recordInvocation`) |
| §9 rate limits | Plan 1 Task 17 — the `billing` budget already exists |
| Excluded: `delete_payment`, `delete_package` | Global Constraints |

**Placeholder scan:** Task 5 Step 4 gives one tool in full and a specification table for the other five rather than repeating near-identical code six times. Each row names the exact validator call and required inputs, and the shared `runMoneyTool` wrapper is given in full — an implementer has everything needed. Task 4 Step 4 and Task 6 Step 1 describe behaviour rather than showing every line, but each specifies exact assertions and exact tool names.

**Type consistency check:** `Validated<T>`, `validateRecordPayment`, `validateBillingEntry`, `validateReasonedMutation` and `callBillingRpc` are defined in Task 1 and consumed unchanged in Task 5. `isConfirmed`, `requireIdempotencyKey` and `dryRun` are defined in Task 2 and consumed in Task 5 and in the route change. `isIsoDate` comes from Plan 1 Task 15 and is imported by Tasks 3 and 4. `isIsoTime` and `normalizeDuration` are defined in Task 4. `ToolError`, `McpToolDefinition` and `ToolContext` come from Plan 1.

**Verification required during execution, not assumed:** the `set_patient_clinic_id` and `set_appointment_creator` triggers actually populating `clinic_id` / `created_by` from `auth.uid()`; a unique constraint on `session_notes.appointment_id` for the upsert; and the exact `appointment_types` column names. Each is flagged inline in the task that depends on it.
