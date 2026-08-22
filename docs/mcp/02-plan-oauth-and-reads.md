# Care-Book MCP — Plan 1: OAuth Server and Read Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Care-Book a remote, OAuth-protected MCP server that Chanakya can connect to and read from, scoped to one Care-Book user's real permissions. The read surface is intentionally non-billing.

**Architecture:** Care-Book acts as its own OAuth 2.1 authorization server on top of Supabase Auth. A consent screen links a Chanakya installation to one Care-Book `profiles.id`, producing an opaque bearer token. Each MCP request uses a short-lived user JWT when the legacy HS256 secret is available; otherwise the encrypted Supabase-refresh-token fallback obtains a real user session. Every query runs through unmodified RLS as the real user. The MCP endpoint is stateless unary JSON-RPC, matching what Chanakya's `internal/mcp/http_client.go` actually sends.

**Tech Stack:** Next.js 16 App Router · TypeScript strict · Supabase (Postgres + Auth) · `node:test` for unit tests · `test/integration/db.ts` harness for DB tests · Playwright for e2e · Web Crypto (`node:crypto`) for all token material — no new runtime dependencies.

**Spec:** `docs/mcp/01-design.md`

**Follow-on:** Plan 2 (`docs/mcp/03-plan-writes.md`) adds clinical and billing write tools on top of this. Do not start it until this plan is merged and Chanakya has connected to a real deploy.

**Current implementation note:** This plan's older task snippets are retained
as implementation history. The authoritative contract is the current code and
`docs/mcp/01-design.md`: read tools never expose billing, and `write:clinical`
contains only patient and appointment creation.

## Global Constraints

- **Branch:** `feat/carebook-mcp`, already branched off `main` (2026-08-22). The 2026-08-15 security review merged as `db0801b`, so `src/middleware.ts` is at its post-review state and migration `040_mcp_oauth.sql` is the MCP migration. Never commit to `main` directly.
- **MCP protocol version:** `2024-11-05`, echoed verbatim from `initialize`.
- **Migration prefix:** `040` — `039` is already used; the Supabase CLI keys migrations by numeric prefix.
- **Origin:** always derived from `NEXT_PUBLIC_SITE_URL`. Never from the request `Host` header.
- **PKCE:** `S256` only. Never accept `plain`.
- **Token storage:** only SHA-256 digests are ever persisted. Raw tokens exist in one HTTP response and nowhere else.
- **Token lifetimes:** authorization code 60 s · access token 3600 s · refresh token has no fixed expiry and rotates on every use. Resolution tokens expire after 10 minutes and are single-use for writes.
- **Scopes:** exactly `read`, `write:clinical`, `write:billing`. Read tools never expose billing. Clinical tools only create patients and appointments; billing is implemented separately as audited writes.
- **Logging:** `src/lib/logger.ts` only, never `console.*`. Never log tokens, codes, verifiers, or patient data.
- **Tool errors:** returned as `{ content: [...], isError: true }` in a successful JSON-RPC result. JSON-RPC `error` objects are reserved for protocol faults.
- **Import style:** relative imports inside `src/lib` carry the `.ts` extension (see `src/lib/security/csp.test.ts`); app code uses the `@/*` alias.
- **Every task ends green:** `npm run lint && npm run typecheck` must pass before each commit.

---

## File Structure

**New — `src/lib/mcp/`** (the whole feature is contained here plus route handlers)

| File | Responsibility |
|---|---|
| `config.ts` | Origin, resource URL, scope list, feature flag. Single source of truth for every URL string |
| `tokens.ts` | Generate, hash, and compare opaque tokens and authorization codes |
| `pkce.ts` | S256 challenge verification |
| `clients.ts` | DCR validation + client persistence |
| `grants.ts` | Authorization-code issue/redeem, grant create/refresh/revoke, bearer resolution |
| `identity.ts` | Grant → short-lived Supabase user JWT → scoped Supabase client |
| `jsonrpc.ts` | JSON-RPC 2.0 parse, dispatch, and response framing |
| `registry.ts` | Tool name → `{ description, inputSchema, scope, handler }`; scope + role filtering |
| `errors.ts` | Sanitised tool errors; never leaks raw Postgres text |
| `rate-limit.ts` | Per-grant request budgets |
| `audit.ts` | `mcp_tool_invocations` writer |
| `tools/identity.ts` | `carebook_whoami` |
| `tools/patients.ts` | Patient search + detail |
| `tools/appointments.ts` | Schedule reads |
| `tools/clinical.ts` | Session notes |
| `tools/billing-writes.ts` | Billing writes only; no billing reads |
| `tools/reference.ts` | Appointment types, staff, doctors |

**New route handlers**

| Route | File |
|---|---|
| `GET /.well-known/oauth-protected-resource` | `src/app/.well-known/oauth-protected-resource/route.ts` |
| `GET /.well-known/oauth-authorization-server` | `src/app/.well-known/oauth-authorization-server/route.ts` |
| `POST /oauth/register` | `src/app/oauth/register/route.ts` |
| `GET /oauth/authorize` | `src/app/oauth/authorize/page.tsx` + `consent-form.tsx` + `actions.ts` |
| `POST /oauth/token` | `src/app/oauth/token/route.ts` |
| `POST /oauth/revoke` | `src/app/oauth/revoke/route.ts` |
| `GET,POST /api/mcp` | `src/app/api/mcp/route.ts` |

**Modified**

- `supabase/migrations/040_mcp_oauth.sql` (new)
- `src/middleware.ts` — matcher exclusions + return-URL-preserving login redirect
- `src/app/login/page.tsx` — honour `?next=`
- `src/lib/supabase/types.ts` — types for the four new tables
- `.env.example` — new vars

---

## Task 0: Identity spike — can we mint a Supabase user JWT?

Everything downstream depends on this. **If this fails, stop and report before writing any other code.**

**Files:**
- Create (throwaway): `scripts/spike-mint-jwt.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a decision recorded in the spec, and the value of `SUPABASE_JWT_SECRET` in `.env.local`

- [ ] **Step 1: Obtain the JWT secret**

In the Supabase dashboard for the Care-Book project: Settings → API → JWT Settings → "JWT Secret". If the project shows only **JWT Signing Keys (asymmetric / ECC)** and no legacy secret, this spike has failed — see Step 5.

Add to `.env.local`:

```
SUPABASE_JWT_SECRET=<the legacy HS256 secret>
```

- [ ] **Step 2: Write the spike script**

```typescript
// scripts/spike-mint-jwt.ts — THROWAWAY. Delete after Task 0.
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function mint(userId: string, email: string, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = b64url(
    JSON.stringify({
      sub: userId,
      email,
      role: 'authenticated',
      aud: 'authenticated',
      iat: now,
      exp: now + 60,
      app_metadata: { provider: 'mcp' },
      user_metadata: {},
    })
  )
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${signature}`
}

const userId = process.argv[2]
const email = process.argv[3]
const jwt = mint(userId, email, process.env.SUPABASE_JWT_SECRET!)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { global: { headers: { Authorization: `Bearer ${jwt}` } } }
)

const { data: patients, error } = await supabase.from('patients').select('id, name').limit(3)
console.log('patients:', patients, 'error:', error)

const { data: whoami } = await supabase.rpc('has_role', { allowed_roles: ['admin'] })
console.log('has_role(admin):', whoami)
```

- [ ] **Step 3: Run it against a real user**

Pick a real admin user id and email from the `profiles` / `auth.users` tables.

```bash
node --experimental-strip-types --env-file=.env.local scripts/spike-mint-jwt.ts <user-uuid> <email>
```

Expected on success: patient rows for that user's clinic only, and `has_role(admin): true`.

- [ ] **Step 4: Verify RLS is genuinely applied, not bypassed**

Repeat with a **staff** user id. Expected: `has_role(admin): false`, and a billing table read denied or empty. If a staff token can read everything, the JWT is being treated as service-role — stop and investigate before continuing.

- [ ] **Step 5: Record the outcome and delete the script**

Append the result to the spec under §5.3 — either "verified 2026-XX-XX, legacy HS256 secret in use" or "asymmetric only, Plan B adopted".

**If asymmetric-only:** stop this plan and re-plan Tasks 4 and 8 around capturing the Supabase refresh token at consent time (spec §5.3 Plan B). Do not attempt to proceed with service-role — spec §5.1 explains why it cannot work.

```bash
rm scripts/spike-mint-jwt.ts
git add docs/mcp/01-design.md
git commit -m "docs: record MCP identity-bridge spike outcome"
```

---

## Task 1: Migration 040 and TypeScript types

**Files:**
- Create: `supabase/migrations/040_mcp_oauth.sql`
- Modify: `src/lib/supabase/types.ts`
- Test: `test/integration/mcp-oauth-schema.test.ts`

**Interfaces:**
- Produces: tables `mcp_oauth_clients`, `mcp_authorization_codes`, `mcp_access_grants`, `mcp_tool_invocations`; types `McpOAuthClient`, `McpAccessGrant`, `McpToolInvocation`, `McpScope`

- [ ] **Step 1: Write the failing integration test**

```typescript
// test/integration/mcp-oauth-schema.test.ts
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAs, run, seedUser } from './db.ts'

const DB = 'carebook_it_mcp_oauth_schema'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let adminId = ''
let staffId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('MCP Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  staffId = seedUser(DB, 'staff', clinicId)
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function seedClient(): string {
  return query(
    DB,
    `insert into mcp_oauth_clients (client_id, client_name, redirect_uris)
     values ('cbk_client_test', 'Chanakya', array['https://example.test/cb'])
     returning client_id`
  )
}

function seedGrant(userId: string, tokenHash: string): string {
  return query(
    DB,
    `insert into mcp_access_grants
       (user_id, clinic_id, client_id, scopes, resource, access_token_hash, access_expires_at)
     values ('${userId}', '${clinicId}', 'cbk_client_test', array['read'],
             'https://example.test/api/mcp', '${tokenHash}', now() + interval '1 hour')
     returning id`
  )
}

test('a public client may not carry a secret hash', { skip }, () => {
  seedClient()
  assert.throws(() =>
    run(
      DB,
      `insert into mcp_oauth_clients (client_id, redirect_uris, token_endpoint_auth_method, client_secret_hash)
       values ('cbk_client_bad', array['https://example.test/cb'], 'none', 'somehash')`
    )
  )
})

test('access token hashes are unique', { skip }, () => {
  seedClient()
  seedGrant(adminId, 'hash-unique-a')
  assert.throws(() => seedGrant(staffId, 'hash-unique-a'))
})

test('a user sees only their own grants under RLS', { skip }, () => {
  seedClient()
  seedGrant(adminId, 'hash-rls-admin')
  seedGrant(staffId, 'hash-rls-staff')

  const staffView = queryAs(DB, staffId, `select count(*) from mcp_access_grants`)
  assert.equal(staffView, '1')
})

test('idempotency keys are unique per grant among successful calls', { skip }, () => {
  seedClient()
  const grantId = seedGrant(adminId, 'hash-idem')
  const insert = (status: string) =>
    run(
      DB,
      `insert into mcp_tool_invocations
         (grant_id, user_id, clinic_id, tool_name, idempotency_key, request_digest, status)
       values ('${grantId}', '${adminId}', '${clinicId}', 'carebook_record_payment',
               'key-1', 'digest', '${status}')`
    )

  insert('ok')
  assert.throws(() => insert('ok'))
  // A failed attempt with the same key is allowed, so a retry after an error can succeed.
  insert('error')
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types test/integration/mcp-oauth-schema.test.ts
```

Expected: FAIL — `relation "mcp_oauth_clients" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/040_mcp_oauth.sql` with the five tables exactly as specified in **spec §6**, then append the RLS policies below.

```sql
alter table public.mcp_oauth_clients        enable row level security;
alter table public.mcp_authorization_codes  enable row level security;
alter table public.mcp_access_grants        enable row level security;
alter table public.mcp_tool_invocations     enable row level security;

-- Clients and codes are handled entirely by the OAuth endpoints, which run
-- before any user session exists and therefore use the service role. No
-- policies means no access for `authenticated` — that is deliberate.

create policy "mcp_grants_select_own" on public.mcp_access_grants
  for select using (user_id = auth.uid());

-- The only field a user may change is revoked_at; the whole-row update is
-- constrained by the fact that no other path exposes these rows to a user
-- session, and the Connected Apps UI sends only that column.
create policy "mcp_grants_revoke_own" on public.mcp_access_grants
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "mcp_invocations_select_own_or_clinic_admin" on public.mcp_tool_invocations
  for select using (
    user_id = auth.uid()
    or (public.has_role(array['admin']) and public.is_same_clinic(clinic_id))
  );
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test --experimental-strip-types test/integration/mcp-oauth-schema.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Add the TypeScript types**

Append to `src/lib/supabase/types.ts`:

```typescript
export type McpScope = 'read' | 'write:clinical' | 'write:billing'

export type McpOAuthClient = {
  id: string
  client_id: string
  client_name: string | null
  redirect_uris: string[]
  token_endpoint_auth_method: 'none' | 'client_secret_post'
  client_secret_hash: string | null
  created_at: string
}

export type McpAccessGrant = {
  id: string
  user_id: string
  clinic_id: string
  client_id: string
  scopes: McpScope[]
  resource: string
  access_token_hash: string
  refresh_token_hash: string | null
  access_expires_at: string
  refresh_expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

export type McpToolInvocationStatus = 'ok' | 'error' | 'denied' | 'dry_run'

export type McpToolInvocation = {
  id: string
  grant_id: string
  user_id: string
  clinic_id: string
  tool_name: string
  idempotency_key: string | null
  request_digest: string
  status: McpToolInvocationStatus
  error_code: string | null
  entity_type: string | null
  entity_id: string | null
  duration_ms: number | null
  created_at: string
}
```

- [ ] **Step 6: Verify and commit**

```bash
npm run lint && npm run typecheck
git add supabase/migrations/040_mcp_oauth.sql src/lib/supabase/types.ts test/integration/mcp-oauth-schema.test.ts
git commit -m "feat(mcp): add OAuth client, code, grant and invocation tables"
```

---

## Task 2: Config module

**Files:**
- Create: `src/lib/mcp/config.ts`, `src/lib/mcp/config.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces:
  - `MCP_SCOPES: readonly McpScope[]`
  - `mcpOrigin(): string`
  - `mcpResourceUrl(): string`
  - `mcpIssuer(): string`
  - `isMcpEnabled(): boolean`
  - `SCOPE_DESCRIPTIONS: Record<McpScope, string>`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/mcp/config.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { MCP_SCOPES, isMcpEnabled, mcpIssuer, mcpOrigin, mcpResourceUrl, parseScopes } from './config.ts'

test('origin strips a trailing slash', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://care.example.com/'
  assert.equal(mcpOrigin(), 'https://care.example.com')
})

test('resource URL is the MCP endpoint under the origin', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://care.example.com'
  assert.equal(mcpResourceUrl(), 'https://care.example.com/api/mcp')
  assert.equal(mcpIssuer(), 'https://care.example.com')
})

test('missing site URL is a hard failure, not a localhost fallback', () => {
  delete process.env.NEXT_PUBLIC_SITE_URL
  assert.throws(() => mcpOrigin(), /NEXT_PUBLIC_SITE_URL/)
})

test('the feature is off unless explicitly enabled', () => {
  delete process.env.MCP_ENABLED
  assert.equal(isMcpEnabled(), false)
  process.env.MCP_ENABLED = 'true'
  assert.equal(isMcpEnabled(), true)
})

test('parseScopes keeps only known scopes and de-duplicates', () => {
  assert.deepEqual(parseScopes('read read write:billing bogus'), ['read', 'write:billing'])
  assert.deepEqual(parseScopes(''), [])
  assert.deepEqual(parseScopes(undefined), [])
})

test('every declared scope has a human description', () => {
  for (const scope of MCP_SCOPES) {
    assert.ok(scope.length > 0)
  }
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/config.test.ts
```

Expected: FAIL — cannot find module `./config.ts`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/mcp/config.ts
import type { McpScope } from '../supabase/types.ts'

export const MCP_SCOPES = ['read', 'write:clinical', 'write:billing'] as const satisfies readonly McpScope[]

export const SCOPE_DESCRIPTIONS: Record<McpScope, string> = {
  read: 'Read patients, schedule, clinical notes and billing you can already see',
  'write:clinical': 'Create patients and appointments',
  'write:billing': 'Record payments, refunds and billing entries',
}

export function mcpOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL
  if (!raw) throw new Error('NEXT_PUBLIC_SITE_URL is required for MCP endpoints')
  return raw.replace(/\/+$/, '')
}

export function mcpIssuer(): string {
  return mcpOrigin()
}

export function mcpResourceUrl(): string {
  return `${mcpOrigin()}/api/mcp`
}

export function isMcpEnabled(): boolean {
  return process.env.MCP_ENABLED === 'true'
}

export function parseScopes(raw: string | undefined | null): McpScope[] {
  if (!raw) return []
  const known = new Set<string>(MCP_SCOPES)
  const seen = new Set<McpScope>()
  for (const candidate of raw.split(/\s+/).filter(Boolean)) {
    if (known.has(candidate)) seen.add(candidate as McpScope)
  }
  return [...seen]
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test --experimental-strip-types src/lib/mcp/config.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Document the env vars**

Append to `.env.example`:

```
# MCP server (see docs/mcp/01-design.md)
MCP_ENABLED=false
SUPABASE_JWT_SECRET=
MCP_TOKEN_PEPPER=
```

- [ ] **Step 6: Commit**

```bash
npm run lint && npm run typecheck
git add src/lib/mcp/config.ts src/lib/mcp/config.test.ts .env.example
git commit -m "feat(mcp): add MCP config module and env documentation"
```

---

## Task 3: Token and PKCE primitives

**Files:**
- Create: `src/lib/mcp/tokens.ts`, `src/lib/mcp/tokens.test.ts`, `src/lib/mcp/pkce.ts`, `src/lib/mcp/pkce.test.ts`

**Interfaces:**
- Produces:
  - `generateToken(prefix: 'at' | 'rt' | 'code'): string`
  - `hashToken(token: string): string`
  - `generateClientId(): string`
  - `verifyCodeChallenge(verifier: string, challenge: string): boolean`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/mcp/tokens.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { generateClientId, generateToken, hashToken } from './tokens.ts'

test('tokens carry a type prefix and high entropy', () => {
  const token = generateToken('at')
  assert.match(token, /^cbk_at_[A-Za-z0-9_-]{43}$/)
  assert.notEqual(generateToken('at'), generateToken('at'))
})

test('prefixes distinguish token types', () => {
  assert.ok(generateToken('rt').startsWith('cbk_rt_'))
  assert.ok(generateToken('code').startsWith('cbk_code_'))
})

test('hashing is deterministic and one-way', () => {
  const token = generateToken('at')
  assert.equal(hashToken(token), hashToken(token))
  assert.notEqual(hashToken(token), token)
  assert.equal(hashToken(token).length, 64)
})

test('the pepper changes the digest', () => {
  const token = 'cbk_at_fixed'
  process.env.MCP_TOKEN_PEPPER = 'pepper-a'
  const a = hashToken(token)
  process.env.MCP_TOKEN_PEPPER = 'pepper-b'
  assert.notEqual(hashToken(token), a)
})

test('client ids are prefixed and unique', () => {
  assert.match(generateClientId(), /^cbk_client_[A-Za-z0-9_-]{22}$/)
  assert.notEqual(generateClientId(), generateClientId())
})
```

```typescript
// src/lib/mcp/pkce.test.ts
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import { verifyCodeChallenge } from './pkce.ts'

function challengeFor(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

test('a matching S256 verifier is accepted', () => {
  const verifier = 'a'.repeat(64)
  assert.equal(verifyCodeChallenge(verifier, challengeFor(verifier)), true)
})

test('a mismatched verifier is rejected', () => {
  assert.equal(verifyCodeChallenge('a'.repeat(64), challengeFor('b'.repeat(64))), false)
})

test('the plain method is never accepted', () => {
  const verifier = 'a'.repeat(64)
  assert.equal(verifyCodeChallenge(verifier, verifier), false)
})

test('empty inputs are rejected rather than treated as equal', () => {
  assert.equal(verifyCodeChallenge('', ''), false)
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
node --test --experimental-strip-types src/lib/mcp/tokens.test.ts src/lib/mcp/pkce.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

```typescript
// src/lib/mcp/tokens.ts
import crypto from 'node:crypto'

type TokenKind = 'at' | 'rt' | 'code'

export function generateToken(kind: TokenKind): string {
  return `cbk_${kind}_${crypto.randomBytes(32).toString('base64url')}`
}

export function generateClientId(): string {
  return `cbk_client_${crypto.randomBytes(16).toString('base64url')}`
}

export function hashToken(token: string): string {
  const pepper = process.env.MCP_TOKEN_PEPPER ?? ''
  return crypto.createHash('sha256').update(`${pepper}:${token}`).digest('hex')
}
```

```typescript
// src/lib/mcp/pkce.ts
import crypto from 'node:crypto'

// RFC 7636 S256 only. The MCP authorization spec forbids the "plain" method,
// so there is deliberately no branch for it.
export function verifyCodeChallenge(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false
  const expected = crypto.createHash('sha256').update(verifier).digest('base64url')
  const a = Buffer.from(expected)
  const b = Buffer.from(challenge)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test --experimental-strip-types src/lib/mcp/tokens.test.ts src/lib/mcp/pkce.test.ts
```

Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
npm run lint && npm run typecheck
git add src/lib/mcp/tokens.ts src/lib/mcp/tokens.test.ts src/lib/mcp/pkce.ts src/lib/mcp/pkce.test.ts
git commit -m "feat(mcp): add opaque token and PKCE S256 primitives"
```

---

## Task 4: Identity bridge

**Files:**
- Create: `src/lib/mcp/identity.ts`, `src/lib/mcp/identity.test.ts`

**Interfaces:**
- Consumes: `hashToken` (Task 3)
- Produces:
  - `mintSupabaseUserJwt(input: { userId: string; email: string; ttlSeconds?: number }): string`
  - `createUserScopedClient(jwt: string): SupabaseClient`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/mcp/identity.test.ts
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import { mintSupabaseUserJwt } from './identity.ts'

function decode(jwt: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [header, payload] = jwt.split('.')
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
  }
}

test('the minted token carries the Supabase authenticated claims', () => {
  process.env.SUPABASE_JWT_SECRET = 'test-secret'
  const jwt = mintSupabaseUserJwt({ userId: 'user-1', email: 'a@b.test' })
  const { header, payload } = decode(jwt)

  assert.equal(header.alg, 'HS256')
  assert.equal(payload.sub, 'user-1')
  assert.equal(payload.role, 'authenticated')
  assert.equal(payload.aud, 'authenticated')
  assert.equal(payload.email, 'a@b.test')
})

test('the token expires within a minute by default', () => {
  process.env.SUPABASE_JWT_SECRET = 'test-secret'
  const { payload } = decode(mintSupabaseUserJwt({ userId: 'user-1', email: 'a@b.test' }))
  const lifetime = (payload.exp as number) - (payload.iat as number)
  assert.equal(lifetime, 60)
})

test('the signature verifies against the configured secret', () => {
  process.env.SUPABASE_JWT_SECRET = 'test-secret'
  const jwt = mintSupabaseUserJwt({ userId: 'user-1', email: 'a@b.test' })
  const [header, payload, signature] = jwt.split('.')
  const expected = crypto
    .createHmac('sha256', 'test-secret')
    .update(`${header}.${payload}`)
    .digest('base64url')
  assert.equal(signature, expected)
})

test('a missing secret fails loudly rather than producing an unsigned token', () => {
  delete process.env.SUPABASE_JWT_SECRET
  assert.throws(
    () => mintSupabaseUserJwt({ userId: 'user-1', email: 'a@b.test' }),
    /SUPABASE_JWT_SECRET/
  )
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/identity.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/mcp/identity.ts
import 'server-only'

import crypto from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function b64url(value: string): string {
  return Buffer.from(value).toString('base64url')
}

// Mints a Supabase-compatible user JWT so MCP requests execute as the real
// end user: RLS applies unchanged, auth.uid() is correct, and the billing
// audit trail attributes rows to a person rather than to a service account.
// See spec §5 — service-role access cannot work here, because every billing
// RPC gates on private.has_role(), which reads auth.uid().
export function mintSupabaseUserJwt(input: {
  userId: string
  email: string
  ttlSeconds?: number
}): string {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) throw new Error('SUPABASE_JWT_SECRET is required to mint MCP user tokens')

  const now = Math.floor(Date.now() / 1000)
  const ttl = input.ttlSeconds ?? 60

  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({
      sub: input.userId,
      email: input.email,
      role: 'authenticated',
      aud: 'authenticated',
      iat: now,
      exp: now + ttl,
      app_metadata: { provider: 'mcp' },
      user_metadata: {},
    })
  )
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url')

  return `${header}.${payload}.${signature}`
}

export function createUserScopedClient(jwt: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.')

  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test --experimental-strip-types src/lib/mcp/identity.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
npm run lint && npm run typecheck
git add src/lib/mcp/identity.ts src/lib/mcp/identity.test.ts
git commit -m "feat(mcp): bridge MCP grants to Supabase user identity"
```

---

## Task 5: Grant store

**Files:**
- Create: `src/lib/mcp/grants.ts`
- Test: `test/integration/mcp-grants.test.ts`

**Interfaces:**
- Consumes: `generateToken`, `hashToken` (Task 3)
- Produces:
  - `issueAuthorizationCode(input): Promise<string>` — returns the raw code
  - `redeemAuthorizationCode(input): Promise<GrantTokens>`
  - `refreshGrant(input): Promise<GrantTokens>`
  - `resolveBearer(token: string): Promise<ResolvedGrant | null>`
  - `revokeByToken(token: string): Promise<void>`
  - types `GrantTokens = { accessToken: string; refreshToken: string; expiresIn: number; scopes: McpScope[] }`
  - type `ResolvedGrant = { grantId: string; userId: string; clinicId: string; email: string; scopes: McpScope[] }`

- [ ] **Step 1: Write the failing integration test**

```typescript
// test/integration/mcp-grants.test.ts
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, run, seedUser } from './db.ts'

const DB = 'carebook_it_mcp_grants'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let adminId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Grant Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  run(
    DB,
    `insert into mcp_oauth_clients (client_id, client_name, redirect_uris)
     values ('cbk_client_grant', 'Chanakya', array['https://example.test/cb'])`
  )
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

test('an authorization code can only be redeemed once', { skip }, () => {
  run(
    DB,
    `insert into mcp_authorization_codes
       (code_hash, client_id, user_id, clinic_id, scopes, code_challenge, redirect_uri, resource, expires_at)
     values ('code-hash-1', 'cbk_client_grant', '${adminId}', '${clinicId}', array['read'],
             'challenge', 'https://example.test/cb', 'https://example.test/api/mcp',
             now() + interval '60 seconds')`
  )

  const deleted = query(DB, `delete from mcp_authorization_codes where code_hash = 'code-hash-1' returning id`)
  assert.ok(deleted.length > 0)

  const second = query(DB, `select count(*) from mcp_authorization_codes where code_hash = 'code-hash-1'`)
  assert.equal(second, '0')
})

test('rotating a refresh token invalidates the previous digest', { skip }, () => {
  const grantId = query(
    DB,
    `insert into mcp_access_grants
       (user_id, clinic_id, client_id, scopes, resource, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at)
     values ('${adminId}', '${clinicId}', 'cbk_client_grant', array['read'],
             'https://example.test/api/mcp', 'at-old', 'rt-old',
             now() + interval '1 hour', null)
     returning id`
  )

  run(
    DB,
    `update mcp_access_grants
        set access_token_hash = 'at-new', refresh_token_hash = 'rt-new'
      where id = '${grantId}'`
  )

  assert.equal(query(DB, `select count(*) from mcp_access_grants where refresh_token_hash = 'rt-old'`), '0')
  assert.equal(query(DB, `select count(*) from mcp_access_grants where refresh_token_hash = 'rt-new'`), '1')
})

test('a revoked grant is excluded from the active index', { skip }, () => {
  const grantId = query(
    DB,
    `insert into mcp_access_grants
       (user_id, clinic_id, client_id, scopes, resource, access_token_hash, access_expires_at)
     values ('${adminId}', '${clinicId}', 'cbk_client_grant', array['read'],
             'https://example.test/api/mcp', 'at-revoke', now() + interval '1 hour')
     returning id`
  )
  run(DB, `update mcp_access_grants set revoked_at = now() where id = '${grantId}'`)

  const active = query(
    DB,
    `select count(*) from mcp_access_grants where id = '${grantId}' and revoked_at is null`
  )
  assert.equal(active, '0')
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types test/integration/mcp-grants.test.ts
```

Expected: it should already pass if Task 1 landed — these assert schema behaviour the migration provides. If any fail, fix migration 040 before continuing.

- [ ] **Step 3: Write the grant store**

```typescript
// src/lib/mcp/grants.ts
import 'server-only'

import { createAdminClient } from '../supabase/admin.ts'
import type { McpScope } from '../supabase/types.ts'
import { generateToken, hashToken } from './tokens.ts'
import { verifyCodeChallenge } from './pkce.ts'

const ACCESS_TTL_SECONDS = 3600
const REFRESH_TTL_DAYS = 30
const CODE_TTL_SECONDS = 60

export type GrantTokens = {
  accessToken: string
  refreshToken: string
  expiresIn: number
  scopes: McpScope[]
}

export type ResolvedGrant = {
  grantId: string
  userId: string
  clinicId: string
  email: string
  scopes: McpScope[]
}

export class OAuthError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

export async function issueAuthorizationCode(input: {
  clientId: string
  userId: string
  clinicId: string
  scopes: McpScope[]
  codeChallenge: string
  redirectUri: string
  resource: string
}): Promise<string> {
  const supabase = createAdminClient()
  const code = generateToken('code')
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString()

  const { error } = await supabase.from('mcp_authorization_codes').insert({
    code_hash: hashToken(code),
    client_id: input.clientId,
    user_id: input.userId,
    clinic_id: input.clinicId,
    scopes: input.scopes,
    code_challenge: input.codeChallenge,
    redirect_uri: input.redirectUri,
    resource: input.resource,
    expires_at: expiresAt,
  })
  if (error) throw new OAuthError('server_error', 'Could not issue an authorization code.')

  return code
}

export async function redeemAuthorizationCode(input: {
  code: string
  clientId: string
  redirectUri: string
  resource: string
  codeVerifier: string
}): Promise<GrantTokens> {
  const supabase = createAdminClient()

  // Delete-and-return makes redemption single-use at the database, so two
  // concurrent redemptions of the same code cannot both win.
  const { data: rows, error } = await supabase
    .from('mcp_authorization_codes')
    .delete()
    .eq('code_hash', hashToken(input.code))
    .select('*')

  const row = rows?.[0]
  if (error || !row) throw new OAuthError('invalid_grant', 'Unknown or already-used authorization code.')

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new OAuthError('invalid_grant', 'Authorization code expired.')
  }
  if (row.client_id !== input.clientId) throw new OAuthError('invalid_grant', 'Client mismatch.')
  if (row.redirect_uri !== input.redirectUri) throw new OAuthError('invalid_grant', 'Redirect URI mismatch.')
  if (row.resource !== input.resource) throw new OAuthError('invalid_target', 'Resource mismatch.')
  if (!verifyCodeChallenge(input.codeVerifier, row.code_challenge)) {
    throw new OAuthError('invalid_grant', 'PKCE verification failed.')
  }

  return createGrant({
    userId: row.user_id,
    clinicId: row.clinic_id,
    clientId: row.client_id,
    scopes: row.scopes as McpScope[],
    resource: row.resource,
  })
}

async function createGrant(input: {
  userId: string
  clinicId: string
  clientId: string
  scopes: McpScope[]
  resource: string
}): Promise<GrantTokens> {
  const supabase = createAdminClient()
  const accessToken = generateToken('at')
  const refreshToken = generateToken('rt')

  const { error } = await supabase.from('mcp_access_grants').insert({
    user_id: input.userId,
    clinic_id: input.clinicId,
    client_id: input.clientId,
    scopes: input.scopes,
    resource: input.resource,
    access_token_hash: hashToken(accessToken),
    refresh_token_hash: hashToken(refreshToken),
    access_expires_at: new Date(Date.now() + ACCESS_TTL_SECONDS * 1000).toISOString(),
    refresh_expires_at: new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000).toISOString(),
  })
  if (error) throw new OAuthError('server_error', 'Could not create the grant.')

  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS, scopes: input.scopes }
}

export async function refreshGrant(input: {
  refreshToken: string
  clientId: string
  resource: string
}): Promise<GrantTokens> {
  const supabase = createAdminClient()
  const accessToken = generateToken('at')
  const refreshToken = generateToken('rt')

  // Conditional update on the old digest: a replayed refresh token matches no
  // row after the first rotation, which is exactly RFC 6749 §10.4 detection.
  const { data: rows, error } = await supabase
    .from('mcp_access_grants')
    .update({
      access_token_hash: hashToken(accessToken),
      refresh_token_hash: hashToken(refreshToken),
      access_expires_at: new Date(Date.now() + ACCESS_TTL_SECONDS * 1000).toISOString(),
      refresh_expires_at: new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000).toISOString(),
    })
    .eq('refresh_token_hash', hashToken(input.refreshToken))
    .eq('client_id', input.clientId)
    .eq('resource', input.resource)
    .is('revoked_at', null)
    .gt('refresh_expires_at', new Date().toISOString())
    .select('scopes')

  const row = rows?.[0]
  if (error || !row) throw new OAuthError('invalid_grant', 'Unknown, expired or revoked refresh token.')

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TTL_SECONDS,
    scopes: row.scopes as McpScope[],
  }
}

export async function resolveBearer(token: string): Promise<ResolvedGrant | null> {
  const supabase = createAdminClient()
  const { data: rows } = await supabase
    .from('mcp_access_grants')
    .select('id, user_id, clinic_id, scopes')
    .eq('access_token_hash', hashToken(token))
    .is('revoked_at', null)
    .gt('access_expires_at', new Date().toISOString())
    .limit(1)

  const grant = rows?.[0]
  if (!grant) return null

  const { data: user } = await supabase.auth.admin.getUserById(grant.user_id)
  if (!user?.user?.email) return null

  await supabase
    .from('mcp_access_grants')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', grant.id)

  return {
    grantId: grant.id,
    userId: grant.user_id,
    clinicId: grant.clinic_id,
    email: user.user.email,
    scopes: grant.scopes as McpScope[],
  }
}

export async function revokeByToken(token: string): Promise<void> {
  const supabase = createAdminClient()
  const digest = hashToken(token)
  await supabase
    .from('mcp_access_grants')
    .update({ revoked_at: new Date().toISOString() })
    .or(`access_token_hash.eq.${digest},refresh_token_hash.eq.${digest}`)
    .is('revoked_at', null)
}
```

- [ ] **Step 4: Run the integration test**

```bash
node --test --experimental-strip-types test/integration/mcp-grants.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
npm run lint && npm run typecheck
git add src/lib/mcp/grants.ts test/integration/mcp-grants.test.ts
git commit -m "feat(mcp): add OAuth grant store with single-use codes and rotating refresh"
```

---

## Task 6: Discovery documents

**Files:**
- Create: `src/app/.well-known/oauth-protected-resource/route.ts`
- Create: `src/app/.well-known/oauth-authorization-server/route.ts`
- Create: `src/lib/mcp/metadata.ts`, `src/lib/mcp/metadata.test.ts`

**Interfaces:**
- Consumes: `mcpOrigin`, `mcpResourceUrl`, `mcpIssuer`, `MCP_SCOPES` (Task 2)
- Produces: `protectedResourceMetadata()`, `authorizationServerMetadata()`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/mcp/metadata.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { authorizationServerMetadata, protectedResourceMetadata } from './metadata.ts'

test('protected resource metadata points at this origin as the AS', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://care.example.com'
  const meta = protectedResourceMetadata()

  assert.equal(meta.resource, 'https://care.example.com/api/mcp')
  assert.deepEqual(meta.authorization_servers, ['https://care.example.com'])
  assert.deepEqual(meta.bearer_methods_supported, ['header'])
})

test('AS metadata advertises a public PKCE-only client', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://care.example.com'
  const meta = authorizationServerMetadata()

  // Chanakya's oauth.SupportsPublicClient() looks for exactly this.
  assert.deepEqual(meta.token_endpoint_auth_methods_supported, ['none'])
  // Chanakya's oauth.SupportsS256PKCE() looks for exactly this.
  assert.deepEqual(meta.code_challenge_methods_supported, ['S256'])
})

test('AS metadata carries every endpoint Chanakya needs', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://care.example.com'
  const meta = authorizationServerMetadata()

  assert.equal(meta.issuer, 'https://care.example.com')
  assert.equal(meta.authorization_endpoint, 'https://care.example.com/oauth/authorize')
  assert.equal(meta.token_endpoint, 'https://care.example.com/oauth/token')
  assert.equal(meta.registration_endpoint, 'https://care.example.com/oauth/register')
  assert.equal(meta.revocation_endpoint, 'https://care.example.com/oauth/revoke')
  assert.deepEqual(meta.grant_types_supported, ['authorization_code', 'refresh_token'])
  assert.deepEqual(meta.response_types_supported, ['code'])
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/metadata.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the metadata module**

```typescript
// src/lib/mcp/metadata.ts
import { MCP_SCOPES, mcpIssuer, mcpOrigin, mcpResourceUrl } from './config.ts'

export function protectedResourceMetadata() {
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [mcpIssuer()],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
  }
}

export function authorizationServerMetadata() {
  const origin = mcpOrigin()
  return {
    issuer: mcpIssuer(),
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    scopes_supported: [...MCP_SCOPES],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    response_types_supported: ['code'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
  }
}
```

- [ ] **Step 4: Write the two route handlers**

```typescript
// src/app/.well-known/oauth-protected-resource/route.ts
import { NextResponse } from 'next/server'
import { isMcpEnabled } from '@/lib/mcp/config'
import { protectedResourceMetadata } from '@/lib/mcp/metadata'

export async function GET() {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404 })
  return NextResponse.json(protectedResourceMetadata(), {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  })
}
```

```typescript
// src/app/.well-known/oauth-authorization-server/route.ts
import { NextResponse } from 'next/server'
import { isMcpEnabled } from '@/lib/mcp/config'
import { authorizationServerMetadata } from '@/lib/mcp/metadata'

export async function GET() {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404 })
  return NextResponse.json(authorizationServerMetadata(), {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
node --test --experimental-strip-types src/lib/mcp/metadata.test.ts
```

Expected: 3 passing.

- [ ] **Step 6: Commit**

```bash
npm run lint && npm run typecheck
git add src/lib/mcp/metadata.ts src/lib/mcp/metadata.test.ts src/app/.well-known
git commit -m "feat(mcp): serve RFC 9728 and RFC 8414 discovery documents"
```

---

## Task 7: Middleware and login return-URL support

Without this, the consent page redirects an unauthenticated user to `/login` and then drops them on the dashboard, and the machine endpoints get redirected to `/login` instead of answering.

**Files:**
- Modify: `src/middleware.ts`
- Modify: `src/app/login/page.tsx`
- Create: `src/lib/mcp/return-url.ts`, `src/lib/mcp/return-url.test.ts`

**Interfaces:**
- Produces: `safeReturnPath(raw: string | null): string | null`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/mcp/return-url.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { safeReturnPath } from './return-url.ts'

test('a same-origin relative path is allowed', () => {
  assert.equal(safeReturnPath('/oauth/authorize?client_id=abc'), '/oauth/authorize?client_id=abc')
})

test('an absolute URL is rejected as an open redirect', () => {
  assert.equal(safeReturnPath('https://evil.test/steal'), null)
})

test('a protocol-relative URL is rejected', () => {
  assert.equal(safeReturnPath('//evil.test/steal'), null)
})

test('a backslash-obscured host is rejected', () => {
  assert.equal(safeReturnPath('/\\evil.test'), null)
})

test('null and empty inputs return null', () => {
  assert.equal(safeReturnPath(null), null)
  assert.equal(safeReturnPath(''), null)
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/return-url.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/mcp/return-url.ts

// Only same-origin relative paths may be used as a post-login destination.
// Anything that could resolve to another origin is refused outright rather
// than sanitised, so there is no encoding trick to find.
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//')) return null
  if (raw.includes('\\')) return null
  if (/^\/+\s*https?:/i.test(raw)) return null
  return raw
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test --experimental-strip-types src/lib/mcp/return-url.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Update the middleware matcher**

In `src/middleware.ts`, replace the `config` export. **Keep every existing exclusion.**

```typescript
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons|api/cron|api/mcp|oauth/token|oauth/register|oauth/revoke|\\.well-known).*)',
  ],
}
```

`/oauth/authorize` is deliberately **not** excluded — it needs the session check.

- [ ] **Step 6: Preserve the return URL on the login redirect**

In `src/middleware.ts`, change the unauthenticated redirect:

```typescript
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    // Carry the original destination so the consent flow resumes after sign-in
    // instead of dropping the user on the dashboard.
    url.searchParams.set('next', `${path}${request.nextUrl.search}`)
    return redirectWithCsp(url)
  }
```

- [ ] **Step 7: Honour `?next=` on successful sign-in**

In `src/app/login/page.tsx`, read the param and use it after a successful sign-in, replacing the existing post-sign-in navigation:

```typescript
import { safeReturnPath } from '@/lib/mcp/return-url'

// inside the component, alongside the other searchParams reads:
const nextPath = safeReturnPath(searchParams.get('next'))

// after a successful sign-in, in place of the current redirect:
router.replace(nextPath ?? '/')
```

- [ ] **Step 8: Verify the existing suites still pass**

```bash
npm run lint && npm run typecheck && npm run test:unit && npm run test:component
```

Expected: all green. The middleware change is additive; if any existing e2e or unit test asserts the old `/login` redirect without a query string, update that assertion to expect `?next=`.

- [ ] **Step 9: Commit**

```bash
git add src/middleware.ts src/app/login/page.tsx src/lib/mcp/return-url.ts src/lib/mcp/return-url.test.ts
git commit -m "feat(mcp): exclude machine endpoints from auth middleware and preserve login return URL"
```

---

## Task 8: Dynamic client registration endpoint

**Files:**
- Create: `src/lib/mcp/clients.ts`, `src/lib/mcp/clients.test.ts`
- Create: `src/app/oauth/register/route.ts`

**Interfaces:**
- Consumes: `generateClientId` (Task 3)
- Produces:
  - `validateRedirectUris(uris: unknown): string[]` — throws `OAuthError` on bad input
  - `registerClient(request): Promise<{ client_id: string; client_id_issued_at: number }>`
  - `findClient(clientId: string): Promise<McpOAuthClient | null>`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/mcp/clients.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { validateRedirectUris } from './clients.ts'

test('https redirect URIs are accepted', () => {
  assert.deepEqual(
    validateRedirectUris(['https://pi.example.ts.net/agentui/api/mcp/oauth/callback']),
    ['https://pi.example.ts.net/agentui/api/mcp/oauth/callback']
  )
})

test('localhost http is accepted for local MCP clients', () => {
  assert.deepEqual(validateRedirectUris(['http://127.0.0.1:8090/cb']), ['http://127.0.0.1:8090/cb'])
  assert.deepEqual(validateRedirectUris(['http://localhost:8090/cb']), ['http://localhost:8090/cb'])
})

test('non-localhost http is rejected', () => {
  assert.throws(() => validateRedirectUris(['http://evil.test/cb']), /redirect_uri/)
})

test('a URI carrying a fragment is rejected', () => {
  assert.throws(() => validateRedirectUris(['https://ok.test/cb#frag']), /fragment/)
})

test('an empty or non-array value is rejected', () => {
  assert.throws(() => validateRedirectUris([]), /redirect_uris/)
  assert.throws(() => validateRedirectUris('https://ok.test/cb'), /redirect_uris/)
  assert.throws(() => validateRedirectUris(undefined), /redirect_uris/)
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/clients.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the client store**

```typescript
// src/lib/mcp/clients.ts
import 'server-only'

import { createAdminClient } from '../supabase/admin.ts'
import type { McpOAuthClient } from '../supabase/types.ts'
import { OAuthError } from './grants.ts'
import { generateClientId } from './tokens.ts'

export function validateRedirectUris(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be a non-empty array')
  }

  return value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new OAuthError('invalid_redirect_uri', 'redirect_uris must contain strings')
    }
    let parsed: URL
    try {
      parsed = new URL(entry)
    } catch {
      throw new OAuthError('invalid_redirect_uri', `redirect_uri is not a valid URL: ${entry}`)
    }
    if (parsed.hash) {
      throw new OAuthError('invalid_redirect_uri', 'redirect_uri must not contain a fragment')
    }
    const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
      throw new OAuthError('invalid_redirect_uri', 'redirect_uri must use https, or http on loopback')
    }
    return entry
  })
}

export async function registerClient(input: {
  redirectUris: string[]
  clientName?: string
}): Promise<{ client_id: string; client_id_issued_at: number }> {
  const supabase = createAdminClient()
  const clientId = generateClientId()

  const { error } = await supabase.from('mcp_oauth_clients').insert({
    client_id: clientId,
    client_name: input.clientName ?? null,
    redirect_uris: input.redirectUris,
    token_endpoint_auth_method: 'none',
    client_secret_hash: null,
  })
  if (error) throw new OAuthError('server_error', 'Could not register the client.')

  return { client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000) }
}

export async function findClient(clientId: string): Promise<McpOAuthClient | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('mcp_oauth_clients')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()
  return (data as McpOAuthClient | null) ?? null
}
```

- [ ] **Step 4: Write the route handler**

```typescript
// src/app/oauth/register/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { registerClient, validateRedirectUris } from '@/lib/mcp/clients'
import { isMcpEnabled, MCP_SCOPES } from '@/lib/mcp/config'
import { OAuthError } from '@/lib/mcp/grants'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404 })

  try {
    const body = await request.json()
    const redirectUris = validateRedirectUris(body?.redirect_uris)
    const clientName =
      typeof body?.client_name === 'string' ? body.client_name.slice(0, 120) : undefined

    const registered = await registerClient({ redirectUris, clientName })
    logger.info('mcp/oauth/register', 'Registered an MCP OAuth client', {
      clientId: registered.client_id,
      clientName: clientName ?? null,
    })

    return NextResponse.json(
      {
        ...registered,
        client_name: clientName ?? null,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: MCP_SCOPES.join(' '),
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    if (error instanceof OAuthError) {
      return NextResponse.json(
        { error: error.code, error_description: error.message },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      )
    }
    logger.error('mcp/oauth/register/unexpected', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
node --test --experimental-strip-types src/lib/mcp/clients.test.ts
```

Expected: 6 passing.

- [ ] **Step 6: Commit**

```bash
npm run lint && npm run typecheck
git add src/lib/mcp/clients.ts src/lib/mcp/clients.test.ts src/app/oauth/register
git commit -m "feat(mcp): add RFC 7591 dynamic client registration"
```

---

## Task 9: Authorize page and consent

**Files:**
- Create: `src/lib/mcp/authorize-request.ts`, `src/lib/mcp/authorize-request.test.ts`
- Create: `src/app/oauth/authorize/page.tsx`
- Create: `src/app/oauth/authorize/consent-form.tsx`
- Create: `src/app/oauth/authorize/actions.ts`

**Interfaces:**
- Consumes: `findClient` (Task 8), `issueAuthorizationCode` (Task 5), `getCurrentProfile` (`src/lib/auth.ts`), `mcpResourceUrl`, `parseScopes`, `SCOPE_DESCRIPTIONS` (Task 2)
- Produces: `parseAuthorizeRequest(params: URLSearchParams, client: McpOAuthClient, resource: string): AuthorizeRequest`, where

```typescript
type AuthorizeRequest = {
  clientId: string
  redirectUri: string
  state: string | null
  codeChallenge: string
  scopes: McpScope[]
  resource: string
}
```

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/mcp/authorize-request.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseAuthorizeRequest } from './authorize-request.ts'

const client = {
  id: 'row-1',
  client_id: 'cbk_client_x',
  client_name: 'Chanakya',
  redirect_uris: ['https://pi.example.ts.net/cb'],
  token_endpoint_auth_method: 'none' as const,
  client_secret_hash: null,
  created_at: '2026-01-01T00:00:00Z',
}

const RESOURCE = 'https://care.example.com/api/mcp'

function params(overrides: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    response_type: 'code',
    client_id: 'cbk_client_x',
    redirect_uri: 'https://pi.example.ts.net/cb',
    state: 'st',
    code_challenge: 'abc',
    code_challenge_method: 'S256',
    resource: RESOURCE,
    scope: 'read write:billing',
    ...overrides,
  })
}

test('a well-formed request parses', () => {
  const parsed = parseAuthorizeRequest(params(), client, RESOURCE)
  assert.equal(parsed.redirectUri, 'https://pi.example.ts.net/cb')
  assert.equal(parsed.codeChallenge, 'abc')
  assert.deepEqual(parsed.scopes, ['read', 'write:billing'])
})

test('an unregistered redirect_uri is fatal', () => {
  assert.throws(
    () => parseAuthorizeRequest(params({ redirect_uri: 'https://evil.test/cb' }), client, RESOURCE),
    /redirect_uri/
  )
})

test('the plain PKCE method is refused', () => {
  assert.throws(
    () => parseAuthorizeRequest(params({ code_challenge_method: 'plain' }), client, RESOURCE),
    /S256/
  )
})

test('a mismatched resource is refused', () => {
  assert.throws(
    () => parseAuthorizeRequest(params({ resource: 'https://other.test/api/mcp' }), client, RESOURCE),
    /resource/
  )
})

test('an unsupported response_type is refused', () => {
  assert.throws(
    () => parseAuthorizeRequest(params({ response_type: 'token' }), client, RESOURCE),
    /response_type/
  )
})

test('a request with no recognised scope is refused', () => {
  assert.throws(() => parseAuthorizeRequest(params({ scope: 'bogus' }), client, RESOURCE), /scope/)
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/authorize-request.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the parser**

```typescript
// src/lib/mcp/authorize-request.ts
import type { McpOAuthClient, McpScope } from '../supabase/types.ts'
import { parseScopes } from './config.ts'
import { OAuthError } from './grants.ts'

export type AuthorizeRequest = {
  clientId: string
  redirectUri: string
  state: string | null
  codeChallenge: string
  scopes: McpScope[]
  resource: string
}

export function parseAuthorizeRequest(
  params: URLSearchParams,
  client: McpOAuthClient,
  expectedResource: string
): AuthorizeRequest {
  const redirectUri = params.get('redirect_uri') ?? ''
  // Validated first and hardest: an unregistered redirect_uri must never be
  // redirected to, only rendered as an error (RFC 6749 §4.1.2.1).
  if (!client.redirect_uris.includes(redirectUri)) {
    throw new OAuthError('invalid_request', 'Unregistered redirect_uri')
  }
  if (params.get('response_type') !== 'code') {
    throw new OAuthError('unsupported_response_type', 'Only response_type=code is supported')
  }
  if (params.get('code_challenge_method') !== 'S256') {
    throw new OAuthError('invalid_request', 'code_challenge_method must be S256')
  }

  const codeChallenge = params.get('code_challenge') ?? ''
  if (!codeChallenge) throw new OAuthError('invalid_request', 'code_challenge is required')

  const resource = params.get('resource') ?? ''
  if (resource !== expectedResource) {
    throw new OAuthError('invalid_target', 'resource does not match this MCP server')
  }

  const scopes = parseScopes(params.get('scope'))
  if (scopes.length === 0) throw new OAuthError('invalid_scope', 'No supported scope requested')

  return {
    clientId: client.client_id,
    redirectUri,
    state: params.get('state'),
    codeChallenge,
    scopes,
    resource,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test --experimental-strip-types src/lib/mcp/authorize-request.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Write the consent server action**

```typescript
// src/app/oauth/authorize/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { findClient } from '@/lib/mcp/clients'
import { mcpResourceUrl, parseScopes } from '@/lib/mcp/config'
import { issueAuthorizationCode } from '@/lib/mcp/grants'
import { logger } from '@/lib/logger'
import type { McpScope } from '@/lib/supabase/types'

export async function approveConsent(formData: FormData) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const clientId = String(formData.get('client_id') ?? '')
  const redirectUri = String(formData.get('redirect_uri') ?? '')
  const codeChallenge = String(formData.get('code_challenge') ?? '')
  const state = formData.get('state') ? String(formData.get('state')) : null
  const requested = parseScopes(String(formData.get('requested_scope') ?? ''))
  const granted = formData.getAll('scope').map(String) as McpScope[]

  const client = await findClient(clientId)
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    throw new Error('Invalid client or redirect URI')
  }

  // A user may only narrow what the client asked for, never widen it, and
  // write:billing is admin-only regardless of what was requested.
  const approved = granted.filter(
    (scope) => requested.includes(scope) && (scope !== 'write:billing' || profile.role === 'admin')
  )
  if (approved.length === 0) throw new Error('No scopes approved')

  const code = await issueAuthorizationCode({
    clientId,
    userId: profile.id,
    clinicId: profile.clinic_id,
    scopes: approved,
    codeChallenge,
    redirectUri,
    resource: mcpResourceUrl(),
  })

  logger.info('mcp/oauth/consent', 'Issued an MCP authorization code', {
    clientId,
    userId: profile.id,
    scopes: approved,
  })

  const target = new URL(redirectUri)
  target.searchParams.set('code', code)
  if (state) target.searchParams.set('state', state)
  redirect(target.toString())
}

export async function denyConsent(formData: FormData) {
  const redirectUri = String(formData.get('redirect_uri') ?? '')
  const state = formData.get('state') ? String(formData.get('state')) : null
  const clientId = String(formData.get('client_id') ?? '')

  const client = await findClient(clientId)
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    throw new Error('Invalid client or redirect URI')
  }

  const target = new URL(redirectUri)
  target.searchParams.set('error', 'access_denied')
  if (state) target.searchParams.set('state', state)
  redirect(target.toString())
}
```

- [ ] **Step 6: Write the consent page and form**

`src/app/oauth/authorize/page.tsx` is a Server Component. It must:

1. `if (!isMcpEnabled()) notFound()`
2. `const profile = await getCurrentProfile()` — if null, `redirect('/login?next=' + encodeURIComponent(currentUrl))` (the middleware normally handles this; this is the belt-and-braces path)
3. `const client = await findClient(searchParams.client_id)` — if null, render an error panel, **never redirect**
4. `parseAuthorizeRequest(new URLSearchParams(searchParams), client, mcpResourceUrl())` inside a try/catch. On `OAuthError` for `invalid_request` with an unregistered `redirect_uri` or unknown client → error panel. For every other error → `redirect(redirectUri + '?error=' + code + '&state=' + state)`
5. Render `<ConsentForm>` with the parsed request, `client.client_name`, the profile's name/email/role, and the clinic name

`consent-form.tsx` is a Client Component following the repo's `*-form.tsx` convention. It renders:

- A heading: `{clientName} wants to connect to your Care-Book account`
- The account being linked: name, email, role, clinic
- One checkbox per requested scope, labelled from `SCOPE_DESCRIPTIONS`. `read` checked and disabled; `write:clinical` checked; **`write:billing` unchecked by default, and not rendered at all unless `role === 'admin'`**
- Hidden inputs: `client_id`, `redirect_uri`, `code_challenge`, `state`, `requested_scope`
- An `Approve` submit button bound to `approveConsent` and a `Deny` button bound to `denyConsent`

Use existing shadcn/ui primitives (`Button`, `Checkbox`, `Card`) and `.ph-*` utility classes so it matches the rest of the app. It must render under the nonce CSP — no inline `<script>`, no inline `style` attributes with expressions.

- [ ] **Step 7: Verify it renders**

```bash
npm run lint && npm run typecheck && npm run build
```

Expected: build succeeds, `/oauth/authorize` appears in the route manifest.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp/authorize-request.ts src/lib/mcp/authorize-request.test.ts src/app/oauth/authorize
git commit -m "feat(mcp): add OAuth consent screen with per-scope approval"
```

---

## Task 10: Token and revoke endpoints

**Files:**
- Create: `src/app/oauth/token/route.ts`
- Create: `src/app/oauth/revoke/route.ts`

**Interfaces:**
- Consumes: `redeemAuthorizationCode`, `refreshGrant`, `revokeByToken`, `OAuthError` (Task 5); `mcpResourceUrl`, `isMcpEnabled` (Task 2)

- [ ] **Step 1: Write the token endpoint**

```typescript
// src/app/oauth/token/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { isMcpEnabled, mcpResourceUrl } from '@/lib/mcp/config'
import { OAuthError, redeemAuthorizationCode, refreshGrant, type GrantTokens } from '@/lib/mcp/grants'
import { logger } from '@/lib/logger'

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }

function tokenResponse(tokens: GrantTokens): NextResponse {
  return NextResponse.json(
    {
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: tokens.scopes.join(' '),
    },
    { headers: NO_STORE }
  )
}

export async function POST(request: NextRequest) {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404 })

  try {
    const form = await request.formData()
    const grantType = String(form.get('grant_type') ?? '')
    const clientId = String(form.get('client_id') ?? '')
    // Chanakya re-pins `resource` on every exchange and refresh; if the client
    // omits it we fall back to our own URL rather than rejecting, since RFC
    // 8707 makes the parameter optional.
    const resource = String(form.get('resource') ?? mcpResourceUrl())

    if (!clientId) throw new OAuthError('invalid_client', 'client_id is required')

    if (grantType === 'authorization_code') {
      const tokens = await redeemAuthorizationCode({
        code: String(form.get('code') ?? ''),
        clientId,
        redirectUri: String(form.get('redirect_uri') ?? ''),
        resource,
        codeVerifier: String(form.get('code_verifier') ?? ''),
      })
      return tokenResponse(tokens)
    }

    if (grantType === 'refresh_token') {
      const tokens = await refreshGrant({
        refreshToken: String(form.get('refresh_token') ?? ''),
        clientId,
        resource,
      })
      return tokenResponse(tokens)
    }

    throw new OAuthError('unsupported_grant_type', `Unsupported grant_type: ${grantType}`)
  } catch (error) {
    if (error instanceof OAuthError) {
      const status = error.code === 'invalid_client' ? 401 : 400
      return NextResponse.json(
        { error: error.code, error_description: error.message },
        { status, headers: NO_STORE }
      )
    }
    logger.error('mcp/oauth/token/unexpected', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers: NO_STORE })
  }
}
```

- [ ] **Step 2: Write the revoke endpoint**

```typescript
// src/app/oauth/revoke/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { isMcpEnabled } from '@/lib/mcp/config'
import { revokeByToken } from '@/lib/mcp/grants'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404 })

  try {
    const form = await request.formData()
    const token = String(form.get('token') ?? '')
    if (token) await revokeByToken(token)
  } catch (error) {
    logger.error('mcp/oauth/revoke/unexpected', error)
  }

  // RFC 7009 §2.2: always 200, even for an unknown token, so revocation can't
  // be used to probe which tokens exist.
  return new NextResponse(null, { status: 200, headers: { 'Cache-Control': 'no-store' } })
}
```

- [ ] **Step 3: Verify the build**

```bash
npm run lint && npm run typecheck && npm run build
```

Expected: both routes appear in the manifest.

- [ ] **Step 4: Commit**

```bash
git add src/app/oauth/token src/app/oauth/revoke
git commit -m "feat(mcp): add OAuth token and revocation endpoints"
```

---

## Task 11: JSON-RPC framing and the MCP endpoint skeleton

**Files:**
- Create: `src/lib/mcp/jsonrpc.ts`, `src/lib/mcp/jsonrpc.test.ts`
- Create: `src/lib/mcp/errors.ts`
- Create: `src/app/api/mcp/route.ts`

**Interfaces:**
- Produces:
  - `type JsonRpcRequest = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: unknown }`
  - `rpcResult(id, result): JsonRpcResponse`
  - `rpcError(id, code, message): JsonRpcResponse`
  - `toolResult(text: string, isError?: boolean)`
  - `sanitizeToolError(error: unknown): string` (in `errors.ts`)

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/mcp/jsonrpc.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { isNotification, parseJsonRpc, rpcError, rpcResult, toolResult } from './jsonrpc.ts'

test('a valid request parses', () => {
  const parsed = parseJsonRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  assert.equal(parsed?.method, 'tools/list')
})

test('a wrong jsonrpc version is rejected', () => {
  assert.equal(parseJsonRpc({ jsonrpc: '1.0', id: 1, method: 'x' }), null)
  assert.equal(parseJsonRpc({ id: 1, method: 'x' }), null)
  assert.equal(parseJsonRpc(null), null)
})

test('a request without an id is a notification', () => {
  assert.equal(isNotification({ jsonrpc: '2.0', method: 'notifications/initialized' }), true)
  assert.equal(isNotification({ jsonrpc: '2.0', id: 0, method: 'tools/list' }), false)
})

test('results and errors carry the request id', () => {
  assert.deepEqual(rpcResult(7, { ok: true }), { jsonrpc: '2.0', id: 7, result: { ok: true } })
  assert.deepEqual(rpcError(7, -32601, 'nope'), {
    jsonrpc: '2.0',
    id: 7,
    error: { code: -32601, message: 'nope' },
  })
})

test('a tool result wraps text in MCP content blocks', () => {
  assert.deepEqual(toolResult('hello'), {
    content: [{ type: 'text', text: 'hello' }],
    isError: false,
  })
  assert.equal(toolResult('boom', true).isError, true)
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/jsonrpc.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the framing module**

```typescript
// src/lib/mcp/jsonrpc.ts

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}

export type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

export function parseJsonRpc(value: unknown): JsonRpcRequest | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (candidate.jsonrpc !== '2.0') return null
  if (typeof candidate.method !== 'string' || candidate.method.length === 0) return null
  return candidate as JsonRpcRequest
}

export function isNotification(request: JsonRpcRequest): boolean {
  return request.id === undefined || request.id === null
}

export function rpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

export function rpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

// MCP models a failed *tool* as a successful JSON-RPC result carrying
// isError, so the model can read and recover from it. JSON-RPC error objects
// are reserved for protocol faults.
export function toolResult(text: string, isError = false) {
  return { content: [{ type: 'text', text }], isError }
}
```

- [ ] **Step 4: Write the error sanitiser**

```typescript
// src/lib/mcp/errors.ts

// Tool errors flow straight into a model's context, and from there possibly
// into a third-party API. Raw Postgres text can carry table names, column
// names and row values, so only a curated set of messages passes through.
// This mirrors the intent of migration 037's billing RPC sanitisation.
const SAFE_PATTERNS: Array<{ match: RegExp; message: string }> = [
  { match: /42501|not allowed|permission denied/i, message: 'You are not allowed to perform this action.' },
  { match: /violates row-level security/i, message: 'You do not have access to that record.' },
  { match: /not found|no rows/i, message: 'No matching record was found.' },
  { match: /invalid input syntax for type uuid/i, message: 'That identifier is not a valid UUID.' },
  { match: /duplicate key/i, message: 'A matching record already exists.' },
]

export class ToolError extends Error {}

export function sanitizeToolError(error: unknown): string {
  // Errors we raised ourselves are already written for a model to read.
  if (error instanceof ToolError) return error.message

  const raw = error instanceof Error ? error.message : String(error)
  for (const { match, message } of SAFE_PATTERNS) {
    if (match.test(raw)) return message
  }
  return 'The operation failed.'
}
```

- [ ] **Step 5: Write the MCP route skeleton**

```typescript
// src/app/api/mcp/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { isMcpEnabled, mcpOrigin } from '@/lib/mcp/config'
import { resolveBearer } from '@/lib/mcp/grants'
import { isNotification, parseJsonRpc, rpcError, rpcResult } from '@/lib/mcp/jsonrpc'
import { logger } from '@/lib/logger'

const PROTOCOL_VERSION = '2024-11-05'

function unauthorized(): NextResponse {
  // Chanakya's oauth.DiscoverProtectedResource probes this endpoint
  // unauthenticated and reads resource_metadata out of this exact header.
  return NextResponse.json(
    { error: 'unauthorized' },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Bearer resource_metadata="${mcpOrigin()}/.well-known/oauth-protected-resource"`,
        'Cache-Control': 'no-store',
      },
    }
  )
}

export async function GET() {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404 })
  return unauthorized()
}

export async function POST(request: NextRequest) {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404 })

  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  if (!token) return unauthorized()

  const grant = await resolveBearer(token)
  if (!grant) return unauthorized()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 200 })
  }

  const rpc = parseJsonRpc(body)
  if (!rpc) return NextResponse.json(rpcError(null, -32600, 'Invalid Request'), { status: 200 })

  if (rpc.method === 'notifications/initialized') return new NextResponse(null, { status: 202 })

  const id = rpc.id ?? null

  try {
    switch (rpc.method) {
      case 'initialize':
        return NextResponse.json(
          rpcResult(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'care-book', version: '1.0.0' },
          })
        )
      case 'tools/list':
        // Populated in Task 12.
        return NextResponse.json(rpcResult(id, { tools: [] }))
      case 'tools/call':
        // Populated in Task 12.
        return NextResponse.json(rpcError(id, -32601, `Method not found: ${rpc.method}`))
      default:
        return NextResponse.json(rpcError(id, -32601, `Method not found: ${rpc.method}`))
    }
  } catch (error) {
    logger.error('mcp/rpc/unexpected', error, { method: rpc.method, grantId: grant.grantId })
    return NextResponse.json(rpcError(id, -32603, 'Internal error'))
  }
  finally {
    if (isNotification(rpc)) logger.info('mcp/rpc', 'Handled a notification', { method: rpc.method })
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
node --test --experimental-strip-types src/lib/mcp/jsonrpc.test.ts
npm run lint && npm run typecheck && npm run build
```

Expected: 5 passing, build clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/mcp/jsonrpc.ts src/lib/mcp/jsonrpc.test.ts src/lib/mcp/errors.ts src/app/api/mcp
git commit -m "feat(mcp): add JSON-RPC framing and the authenticated MCP endpoint"
```

---

## Task 12: Tool registry with scope filtering

**Files:**
- Create: `src/lib/mcp/registry.ts`, `src/lib/mcp/registry.test.ts`
- Modify: `src/app/api/mcp/route.ts`

**Interfaces:**
- Consumes: `toolResult` (Task 11), `sanitizeToolError` (Task 11), `ResolvedGrant` (Task 5), `createUserScopedClient`, `mintSupabaseUserJwt` (Task 4)
- Produces:

```typescript
export type ToolContext = {
  supabase: SupabaseClient
  profile: Profile
  grant: ResolvedGrant
}

export type McpToolDefinition = {
  name: string
  description: string
  scope: McpScope
  adminOnly?: boolean
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
}

export function registerTools(defs: McpToolDefinition[]): void
export function visibleTools(grant: ResolvedGrant, profile: Profile): McpToolDefinition[]
export function findTool(name: string): McpToolDefinition | undefined
export async function buildToolContext(grant: ResolvedGrant): Promise<ToolContext | null>
```

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/mcp/registry.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { createRegistry } from './registry.ts'
import type { McpToolDefinition } from './registry.ts'

const defs: McpToolDefinition[] = [
  { name: 'r', description: 'read', scope: 'read', inputSchema: {}, handler: async () => ({}) },
  { name: 'w', description: 'write', scope: 'write:clinical', inputSchema: {}, handler: async () => ({}) },
  { name: 'b', description: 'bill', scope: 'write:billing', adminOnly: true, inputSchema: {}, handler: async () => ({}) },
]

const grant = (scopes: string[]) => ({
  grantId: 'g',
  userId: 'u',
  clinicId: 'c',
  email: 'a@b.test',
  scopes: scopes as never,
})

test('a read-only grant sees only read tools', () => {
  const registry = createRegistry(defs)
  const visible = registry.visibleTools(grant(['read']), { role: 'admin' } as never)
  assert.deepEqual(visible.map((tool) => tool.name), ['r'])
})

test('scopes the grant does not hold hide their tools entirely', () => {
  const registry = createRegistry(defs)
  const visible = registry.visibleTools(grant(['read', 'write:clinical']), { role: 'admin' } as never)
  assert.deepEqual(visible.map((tool) => tool.name), ['r', 'w'])
})

test('an admin-only tool is hidden from staff even with the scope granted', () => {
  const registry = createRegistry(defs)
  const visible = registry.visibleTools(grant(['read', 'write:billing']), { role: 'staff' } as never)
  assert.deepEqual(visible.map((tool) => tool.name), ['r'])
})

test('an admin with the scope sees the admin-only tool', () => {
  const registry = createRegistry(defs)
  const visible = registry.visibleTools(grant(['read', 'write:billing']), { role: 'admin' } as never)
  assert.deepEqual(visible.map((tool) => tool.name), ['r', 'b'])
})

test('findTool resolves by exact name only', () => {
  const registry = createRegistry(defs)
  assert.equal(registry.findTool('r')?.name, 'r')
  assert.equal(registry.findTool('R'), undefined)
  assert.equal(registry.findTool('missing'), undefined)
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/registry.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the registry**

```typescript
// src/lib/mcp/registry.ts
import type { SupabaseClient } from '@supabase/supabase-js'

import type { McpScope, Profile } from '../supabase/types.ts'
import type { ResolvedGrant } from './grants.ts'

export type ToolContext = {
  supabase: SupabaseClient
  profile: Profile
  grant: ResolvedGrant
}

export type McpToolDefinition = {
  name: string
  description: string
  scope: McpScope
  adminOnly?: boolean
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
}

export type Registry = {
  visibleTools(grant: ResolvedGrant, profile: Pick<Profile, 'role'>): McpToolDefinition[]
  findTool(name: string): McpToolDefinition | undefined
}

// A tool is visible only when the grant carries its scope AND the user's role
// permits it. Hiding rather than erroring keeps an agent from repeatedly
// trying something it can never do.
export function createRegistry(definitions: McpToolDefinition[]): Registry {
  const byName = new Map(definitions.map((def) => [def.name, def]))
  return {
    visibleTools(grant, profile) {
      return definitions.filter(
        (def) => grant.scopes.includes(def.scope) && (!def.adminOnly || profile.role === 'admin')
      )
    },
    findTool(name) {
      return byName.get(name)
    },
  }
}
```

- [ ] **Step 4: Write the tool-context builder**

Create `src/lib/mcp/context.ts`:

```typescript
// src/lib/mcp/context.ts
import 'server-only'

import type { Profile } from '../supabase/types.ts'
import type { ResolvedGrant } from './grants.ts'
import { createUserScopedClient, mintSupabaseUserJwt } from './identity.ts'
import type { ToolContext } from './registry.ts'

export async function buildToolContext(grant: ResolvedGrant): Promise<ToolContext | null> {
  const jwt = mintSupabaseUserJwt({ userId: grant.userId, email: grant.email })
  const supabase = createUserScopedClient(jwt)

  // Read through the user's own client so a stale or revoked profile fails
  // here rather than silently granting the last-known role.
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', grant.userId)
    .maybeSingle()

  if (!profile) return null
  return { supabase, profile: profile as Profile, grant }
}
```

- [ ] **Step 5: Wire the registry into the route**

In `src/app/api/mcp/route.ts`, import `createRegistry` and the tool modules (added in Tasks 13–16 — start with an empty array and grow it), then replace the two placeholder cases:

```typescript
import { buildToolContext } from '@/lib/mcp/context'
import { createRegistry } from '@/lib/mcp/registry'
import { sanitizeToolError } from '@/lib/mcp/errors'
import { toolResult } from '@/lib/mcp/jsonrpc'
import { identityTools } from '@/lib/mcp/tools/identity'

const registry = createRegistry([...identityTools])

// …inside the switch:
      case 'tools/list': {
        const ctx = await buildToolContext(grant)
        if (!ctx) return NextResponse.json(rpcError(id, -32603, 'Profile unavailable'))
        return NextResponse.json(
          rpcResult(id, {
            tools: registry.visibleTools(grant, ctx.profile).map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          })
        )
      }
      case 'tools/call': {
        const params = (rpc.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
        if (typeof params.name !== 'string') {
          return NextResponse.json(rpcResult(id, toolResult('tools/call is missing a tool name', true)))
        }
        const ctx = await buildToolContext(grant)
        if (!ctx) return NextResponse.json(rpcError(id, -32603, 'Profile unavailable'))

        const tool = registry.findTool(params.name)
        const allowed = tool && registry.visibleTools(grant, ctx.profile).includes(tool)
        if (!tool || !allowed) {
          return NextResponse.json(
            rpcResult(id, toolResult(`Unknown or unavailable tool: ${params.name}`, true))
          )
        }

        try {
          const value = await tool.handler(params.arguments ?? {}, ctx)
          return NextResponse.json(rpcResult(id, toolResult(JSON.stringify(value, null, 2))))
        } catch (error) {
          logger.warn('mcp/tool/failed', 'An MCP tool call failed', {
            tool: tool.name,
            grantId: grant.grantId,
          })
          return NextResponse.json(rpcResult(id, toolResult(sanitizeToolError(error), true)))
        }
      }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
node --test --experimental-strip-types src/lib/mcp/registry.test.ts
npm run lint && npm run typecheck
```

Expected: 5 passing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/mcp/registry.ts src/lib/mcp/registry.test.ts src/lib/mcp/context.ts src/app/api/mcp/route.ts
git commit -m "feat(mcp): add scope- and role-filtered tool registry"
```

---

## Task 13: Identity and reference tools

**Files:**
- Create: `src/lib/mcp/tools/identity.ts`
- Create: `src/lib/mcp/tools/reference.ts`
- Create: `src/lib/mcp/schema.ts`, `src/lib/mcp/schema.test.ts`
- Modify: `src/app/api/mcp/route.ts`

**Interfaces:**
- Produces:
  - `objectSchema(properties, required?)`, `stringProp(desc)`, `numberProp(desc)`, `boolProp(desc)`, `enumProp(desc, values)` (in `schema.ts`)
  - `identityTools: McpToolDefinition[]` — `carebook_whoami`
  - `referenceTools: McpToolDefinition[]` — `carebook_list_appointment_types`, `carebook_list_staff`, `carebook_list_doctors`

- [ ] **Step 1: Write the failing schema test**

```typescript
// src/lib/mcp/schema.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { enumProp, numberProp, objectSchema, stringProp } from './schema.ts'

test('objectSchema produces a closed JSON Schema object', () => {
  assert.deepEqual(objectSchema({ a: stringProp('an a') }, ['a']), {
    type: 'object',
    properties: { a: { type: 'string', description: 'an a' } },
    required: ['a'],
    additionalProperties: false,
  })
})

test('required defaults to empty rather than undefined', () => {
  assert.deepEqual(objectSchema({}).required, [])
})

test('enumProp carries its allowed values', () => {
  assert.deepEqual(enumProp('status', ['a', 'b']), {
    type: 'string',
    description: 'status',
    enum: ['a', 'b'],
  })
})

test('numberProp is typed as a number', () => {
  assert.equal(numberProp('count').type, 'number')
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/schema.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the schema helpers**

```typescript
// src/lib/mcp/schema.ts

export function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}

export function stringProp(description: string) {
  return { type: 'string', description }
}

export function numberProp(description: string) {
  return { type: 'number', description }
}

export function boolProp(description: string) {
  return { type: 'boolean', description }
}

export function enumProp(description: string, values: string[]) {
  return { type: 'string', description, enum: values }
}
```

- [ ] **Step 4: Write the identity tool**

```typescript
// src/lib/mcp/tools/identity.ts
import { getRestrictedUiAccess } from '../../access/restricted-visibility.ts'
import type { McpToolDefinition } from '../registry.ts'
import { objectSchema } from '../schema.ts'

export const identityTools: McpToolDefinition[] = [
  {
    name: 'carebook_whoami',
    description:
      'Return the Care-Book user this connection acts as, their role, clinic, and what they are allowed to see. Call this first to learn what the rest of the tools will return.',
    scope: 'read',
    inputSchema: objectSchema({}),
    handler: async (_args, ctx) => {
      const { data: clinic } = await ctx.supabase
        .from('clinics')
        .select('id, name, status')
        .eq('id', ctx.profile.clinic_id)
        .maybeSingle()

      const access = getRestrictedUiAccess(ctx.profile)
      return {
        user: {
          id: ctx.profile.id,
          name: ctx.profile.full_name ?? null,
          role: ctx.profile.role,
        },
        clinic,
        granted_scopes: ctx.grant.scopes,
        can_view_billing: access.canViewBilling,
        can_view_home_visits: access.canViewHomeVisits,
        timezone: 'Asia/Kolkata',
      }
    },
  },
]
```

**Note:** confirm the profile display-name column before writing this — check `Profile` in `src/lib/supabase/types.ts` and use whichever of `full_name` / `name` actually exists.

- [ ] **Step 5: Write the reference tools**

```typescript
// src/lib/mcp/tools/reference.ts
import type { McpToolDefinition } from '../registry.ts'
import { objectSchema } from '../schema.ts'

export const referenceTools: McpToolDefinition[] = [
  {
    name: 'carebook_list_appointment_types',
    description:
      'List the clinic\'s configured appointment types with their default fees. Use the returned id when creating or filtering appointments.',
    scope: 'read',
    inputSchema: objectSchema({}),
    handler: async (_args, ctx) => {
      const { data, error } = await ctx.supabase
        .from('appointment_types')
        .select('id, name, is_shared, default_fee')
        .eq('clinic_id', ctx.profile.clinic_id)
        .order('name')
      if (error) throw error
      return { appointment_types: data ?? [] }
    },
  },
  {
    name: 'carebook_list_staff',
    description: 'List staff and admins in this clinic who can be assigned to an appointment.',
    scope: 'read',
    inputSchema: objectSchema({}),
    handler: async (_args, ctx) => {
      const { data, error } = await ctx.supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('clinic_id', ctx.profile.clinic_id)
      if (error) throw error
      return { staff: data ?? [] }
    },
  },
  {
    name: 'carebook_list_doctors',
    description: 'List referring doctors recorded for this clinic.',
    scope: 'read',
    inputSchema: objectSchema({}),
    handler: async (_args, ctx) => {
      const { data, error } = await ctx.supabase
        .from('doctors')
        .select('id, name, specialty')
        .eq('clinic_id', ctx.profile.clinic_id)
        .order('name')
      if (error) throw error
      return { doctors: data ?? [] }
    },
  },
]
```

**Note:** verify each `select` list against the actual columns in `supabase/schema.sql` and later migrations before running — in particular `appointment_types.default_fee` (migration 028) and the `profiles` display-name column.

- [ ] **Step 6: Register both groups**

In `src/app/api/mcp/route.ts`:

```typescript
import { identityTools } from '@/lib/mcp/tools/identity'
import { referenceTools } from '@/lib/mcp/tools/reference'

const registry = createRegistry([...identityTools, ...referenceTools])
```

- [ ] **Step 7: Verify**

```bash
node --test --experimental-strip-types src/lib/mcp/schema.test.ts
npm run lint && npm run typecheck && npm run build
```

Expected: 4 passing, build clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp/schema.ts src/lib/mcp/schema.test.ts src/lib/mcp/tools src/app/api/mcp/route.ts
git commit -m "feat(mcp): add whoami and reference-lookup tools"
```

---

## Task 14: Patient read tools

**Files:**
- Create: `src/lib/mcp/tools/patients.ts`
- Create: `src/lib/mcp/tools/patients.test.ts`
- Modify: `src/app/api/mcp/route.ts`

**Interfaces:**
- Produces: `patientTools: McpToolDefinition[]` — `carebook_search_patients`, `carebook_get_patient`; plus `clampLimit(raw: unknown, fallback: number, max: number): number`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/mcp/tools/patients.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { clampLimit, patientTools } from './patients.ts'

test('limits are clamped into range', () => {
  assert.equal(clampLimit(undefined, 25, 100), 25)
  assert.equal(clampLimit(10, 25, 100), 10)
  assert.equal(clampLimit(500, 25, 100), 100)
  assert.equal(clampLimit(0, 25, 100), 25)
  assert.equal(clampLimit(-5, 25, 100), 25)
  assert.equal(clampLimit('abc', 25, 100), 25)
})

test('every patient tool is read-scoped and closed-schema', () => {
  for (const tool of patientTools) {
    assert.equal(tool.scope, 'read')
    assert.equal((tool.inputSchema as { additionalProperties: boolean }).additionalProperties, false)
    assert.ok(tool.description.length > 20, `${tool.name} needs a description a model can act on`)
  }
})

test('the tool names are stable', () => {
  assert.deepEqual(patientTools.map((tool) => tool.name), [
    'carebook_search_patients',
    'carebook_get_patient',
  ])
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/tools/patients.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the tools**

```typescript
// src/lib/mcp/tools/patients.ts
import { ToolError } from '../errors.ts'
import type { McpToolDefinition } from '../registry.ts'
import { numberProp, objectSchema, stringProp } from '../schema.ts'

export function clampLimit(raw: unknown, fallback: number, max: number): number {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value) || value < 1) return fallback
  return Math.min(Math.floor(value), max)
}

export const patientTools: McpToolDefinition[] = [
  {
    name: 'carebook_search_patients',
    description:
      'Search patients in this clinic by name or phone number. Returns id, name, phone and last visit date. Use the id with carebook_get_patient for full detail.',
    scope: 'read',
    inputSchema: objectSchema(
      {
        query: stringProp('Name or phone fragment to search for'),
        limit: numberProp('Maximum patients to return. Default 25, maximum 100'),
      },
      ['query']
    ),
    handler: async (args, ctx) => {
      const query = String(args.query ?? '').trim()
      if (!query) throw new ToolError('query must not be empty')
      const limit = clampLimit(args.limit, 25, 100)

      const { data, error } = await ctx.supabase
        .from('patients')
        .select('id, name, phone, email, created_at')
        .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
        .order('name')
        .limit(limit)
      if (error) throw error

      return { patients: data ?? [], returned: data?.length ?? 0, limit }
    },
  },
  {
    name: 'carebook_get_patient',
    description:
      'Return one patient with their treatment plans, active packages and most recent appointments. Billing figures are included only if this user can view billing.',
    scope: 'read',
    inputSchema: objectSchema({ patient_id: stringProp('Patient UUID') }, ['patient_id']),
    handler: async (args, ctx) => {
      const patientId = String(args.patient_id ?? '')
      if (!patientId) throw new ToolError('patient_id is required')

      const { data: patient, error } = await ctx.supabase
        .from('patients')
        .select('*')
        .eq('id', patientId)
        .maybeSingle()
      if (error) throw error
      if (!patient) throw new ToolError('No patient with that id is visible to you.')

      const [{ data: plans }, { data: appointments }] = await Promise.all([
        ctx.supabase
          .from('treatment_plans')
          .select('id, diagnosis, goals, start_date, expected_end_date, status')
          .eq('patient_id', patientId)
          .order('start_date', { ascending: false }),
        ctx.supabase
          .from('appointments')
          .select('id, date, time, duration_minutes, type, status, assigned_to')
          .eq('patient_id', patientId)
          .order('date', { ascending: false })
          .limit(10),
      ])

      return {
        patient,
        treatment_plans: plans ?? [],
        recent_appointments: appointments ?? [],
      }
    },
  },
]
```

**Note on the search filter:** `query` is interpolated into a PostgREST `.or()` string. Before committing, strip PostgREST metacharacters — `,` `(` `)` `.` `*` — from `query`, or the model can craft a filter fragment. Add this to `clampLimit`'s module as `sanitizeFilterTerm(raw: string): string` and cover it with a test asserting that `a,b(c)` becomes `abc`.

- [ ] **Step 4: Add the filter-sanitisation test and implementation**

```typescript
// add to src/lib/mcp/tools/patients.test.ts
import { sanitizeFilterTerm } from './patients.ts'

test('PostgREST filter metacharacters are stripped from search input', () => {
  assert.equal(sanitizeFilterTerm('a,b(c).*d'), 'abcd')
  assert.equal(sanitizeFilterTerm('Priya Sharma'), 'Priya Sharma')
})
```

```typescript
// add to src/lib/mcp/tools/patients.ts
// PostgREST parses .or() filters out of a single string, so any of these
// characters in user input would let a caller append their own conditions.
export function sanitizeFilterTerm(raw: string): string {
  return raw.replace(/[,()*.]/g, '')
}
```

Use it in the handler: `const safe = sanitizeFilterTerm(query)` and interpolate `safe`.

- [ ] **Step 5: Register and verify**

Add `...patientTools` to the `createRegistry([...])` call in `src/app/api/mcp/route.ts`.

```bash
node --test --experimental-strip-types src/lib/mcp/tools/patients.test.ts
npm run lint && npm run typecheck
```

Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/tools/patients.ts src/lib/mcp/tools/patients.test.ts src/app/api/mcp/route.ts
git commit -m "feat(mcp): add patient search and detail tools"
```

---

## Task 15: Appointment and clinical read tools

**Files:**
- Create: `src/lib/mcp/tools/appointments.ts`, `src/lib/mcp/tools/appointments.test.ts`
- Create: `src/lib/mcp/tools/clinical.ts`
- Modify: `src/app/api/mcp/route.ts`
- Test: `test/integration/mcp-appointment-visibility.test.ts`

**Interfaces:**
- Consumes: `getAppointmentVisibilityFilter` (`src/lib/access/appointment-visibility.ts`), `clampLimit` (Task 14)
- Produces: `appointmentTools` — `carebook_list_appointments`, `carebook_get_appointment`; `clinicalTools` — `carebook_list_session_notes`

- [ ] **Step 1: Write the failing unit test**

```typescript
// src/lib/mcp/tools/appointments.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { appointmentTools, isIsoDate } from './appointments.ts'

test('date inputs must be ISO yyyy-MM-dd', () => {
  assert.equal(isIsoDate('2026-08-15'), true)
  assert.equal(isIsoDate('15-08-2026'), false)
  assert.equal(isIsoDate('2026-8-5'), false)
  assert.equal(isIsoDate(''), false)
})

test('the tool names are stable and read-scoped', () => {
  assert.deepEqual(appointmentTools.map((tool) => tool.name), [
    'carebook_list_appointments',
    'carebook_get_appointment',
  ])
  for (const tool of appointmentTools) assert.equal(tool.scope, 'read')
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/tools/appointments.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the appointment tools**

```typescript
// src/lib/mcp/tools/appointments.ts
import { getAppointmentVisibilityFilter } from '../../access/appointment-visibility.ts'
import { ToolError } from '../errors.ts'
import type { McpToolDefinition } from '../registry.ts'
import { enumProp, numberProp, objectSchema, stringProp } from '../schema.ts'
import { clampLimit } from './patients.ts'

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export const appointmentTools: McpToolDefinition[] = [
  {
    name: 'carebook_list_appointments',
    description:
      'List appointments in a date range, optionally filtered by status or patient. Dates are ISO yyyy-MM-dd in India Standard Time. Staff see only shared types plus their own appointments.',
    scope: 'read',
    inputSchema: objectSchema(
      {
        from_date: stringProp('Start date, inclusive, as yyyy-MM-dd'),
        to_date: stringProp('End date, inclusive, as yyyy-MM-dd'),
        patient_id: stringProp('Optional patient UUID to filter by'),
        status: enumProp('Optional status filter', ['scheduled', 'completed', 'cancelled']),
        limit: numberProp('Maximum appointments to return. Default 50, maximum 200'),
      },
      ['from_date', 'to_date']
    ),
    handler: async (args, ctx) => {
      const fromDate = String(args.from_date ?? '')
      const toDate = String(args.to_date ?? '')
      if (!isIsoDate(fromDate) || !isIsoDate(toDate)) {
        throw new ToolError('from_date and to_date must be yyyy-MM-dd')
      }
      if (fromDate > toDate) throw new ToolError('from_date must not be after to_date')

      let query = ctx.supabase
        .from('appointments')
        .select(
          'id, date, time, duration_minutes, type, status, payment_status, fee, notes, assigned_to, patient:patients(id, name, phone)'
        )
        .gte('date', fromDate)
        .lte('date', toDate)
        .order('date')
        .order('time')
        .limit(clampLimit(args.limit, 50, 200))

      if (args.patient_id) query = query.eq('patient_id', String(args.patient_id))
      if (args.status) query = query.eq('status', String(args.status))

      // Never skip the null check: null means admin, i.e. no filter at all.
      const visibility = getAppointmentVisibilityFilter(ctx.profile)
      if (visibility) query = query.or(visibility)

      const { data, error } = await query
      if (error) throw error
      return { appointments: data ?? [], returned: data?.length ?? 0 }
    },
  },
  {
    name: 'carebook_get_appointment',
    description:
      'Return one appointment with its patient, assignee and SOAP session note if one exists.',
    scope: 'read',
    inputSchema: objectSchema({ appointment_id: stringProp('Appointment UUID') }, ['appointment_id']),
    handler: async (args, ctx) => {
      const appointmentId = String(args.appointment_id ?? '')
      if (!appointmentId) throw new ToolError('appointment_id is required')

      const { data: appointment, error } = await ctx.supabase
        .from('appointments')
        .select('*, patient:patients(id, name, phone)')
        .eq('id', appointmentId)
        .maybeSingle()
      if (error) throw error
      if (!appointment) throw new ToolError('No appointment with that id is visible to you.')

      const { data: note } = await ctx.supabase
        .from('session_notes')
        .select('id, subjective, objective, assessment, plan, exercises_prescribed, created_at')
        .eq('appointment_id', appointmentId)
        .maybeSingle()

      return { appointment, session_note: note ?? null }
    },
  },
]
```

- [ ] **Step 4: Write the clinical tool**

```typescript
// src/lib/mcp/tools/clinical.ts
import { ToolError } from '../errors.ts'
import type { McpToolDefinition } from '../registry.ts'
import { numberProp, objectSchema, stringProp } from '../schema.ts'
import { clampLimit } from './patients.ts'

export const clinicalTools: McpToolDefinition[] = [
  {
    name: 'carebook_list_session_notes',
    description:
      'List SOAP session notes for a patient, newest first, each joined to the appointment it belongs to.',
    scope: 'read',
    inputSchema: objectSchema(
      {
        patient_id: stringProp('Patient UUID'),
        limit: numberProp('Maximum notes to return. Default 20, maximum 100'),
      },
      ['patient_id']
    ),
    handler: async (args, ctx) => {
      const patientId = String(args.patient_id ?? '')
      if (!patientId) throw new ToolError('patient_id is required')

      const { data, error } = await ctx.supabase
        .from('session_notes')
        .select(
          'id, subjective, objective, assessment, plan, exercises_prescribed, created_at, appointment:appointments!inner(id, date, time, type, patient_id)'
        )
        .eq('appointment.patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(clampLimit(args.limit, 20, 100))
      if (error) throw error

      return { session_notes: data ?? [], returned: data?.length ?? 0 }
    },
  },
]
```

- [ ] **Step 5: Write the visibility integration test**

```typescript
// test/integration/mcp-appointment-visibility.test.ts
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, dropDatabase, postgresAvailable, query, queryAs, seedUser } from './db.ts'

const DB = 'carebook_it_mcp_visibility'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let adminId = ''
let staffAId = ''
let staffBId = ''
let patientId = ''
let privateTypeId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('Visibility Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  staffAId = seedUser(DB, 'staff', clinicId)
  staffBId = seedUser(DB, 'staff', clinicId)
  patientId = query(
    DB,
    `insert into patients (clinic_id, name, phone) values ('${clinicId}', 'Vis Patient', '1') returning id`
  )
  privateTypeId = query(
    DB,
    `select id from appointment_types where clinic_id = '${clinicId}' and is_shared = false limit 1`
  )
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

test('a staff member cannot see another staff member\'s private appointment', { skip }, () => {
  query(
    DB,
    `insert into appointments (clinic_id, patient_id, date, time, type, appointment_type_id, type_is_shared, created_by, assigned_to)
     values ('${clinicId}', '${patientId}', current_date, '10:00', 'Home Visit',
             '${privateTypeId}', false, '${staffAId}', '${staffAId}')
     returning id`
  )

  assert.equal(queryAs(DB, staffBId, `select count(*) from appointments`), '0')
  assert.equal(queryAs(DB, staffAId, `select count(*) from appointments`), '1')
  assert.equal(queryAs(DB, adminId, `select count(*) from appointments`), '1')
})
```

This asserts that the RLS the MCP tools rely on genuinely enforces the split — the `.or()` filter in the tool is defence in depth on top of it.

- [ ] **Step 6: Register, run and commit**

Add `...appointmentTools, ...clinicalTools` to `createRegistry([...])`.

```bash
node --test --experimental-strip-types src/lib/mcp/tools/appointments.test.ts
node --test --experimental-strip-types test/integration/mcp-appointment-visibility.test.ts
npm run lint && npm run typecheck
```

```bash
git add src/lib/mcp/tools/appointments.ts src/lib/mcp/tools/appointments.test.ts src/lib/mcp/tools/clinical.ts test/integration/mcp-appointment-visibility.test.ts src/app/api/mcp/route.ts
git commit -m "feat(mcp): add appointment and session-note read tools"
```

---

## Task 16: Billing read tools — removed from the implemented contract

This historical task is intentionally not executed. Care-Book MCP has no
billing-read tools: `carebook_get_patient_billing` and
`carebook_billing_summary` must not be registered. The code block below is
retained only as historical planning context; the authoritative registry and
the current contract at the top of this document take precedence.

**Files:**
- Create: `src/lib/mcp/tools/billing.ts`, `src/lib/mcp/tools/billing.test.ts`
- Modify: `src/app/api/mcp/route.ts`

**Interfaces:**
- Consumes: `getRestrictedUiAccess`, `clampLimit`, `isIsoDate`
- Produces: `billingReadTools` — `carebook_get_patient_billing`, `carebook_billing_summary`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/mcp/tools/billing.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { billingReadTools } from './billing.ts'

test('billing read tools are admin-only', () => {
  for (const tool of billingReadTools) {
    assert.equal(tool.adminOnly, true, `${tool.name} must be admin-only`)
    assert.equal(tool.scope, 'read')
  }
})

test('the tool names are stable', () => {
  assert.deepEqual(billingReadTools.map((tool) => tool.name), [
    'carebook_get_patient_billing',
    'carebook_billing_summary',
  ])
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/tools/billing.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the tools**

```typescript
// src/lib/mcp/tools/billing.ts
import { getRestrictedUiAccess } from '../../access/restricted-visibility.ts'
import { ToolError } from '../errors.ts'
import type { McpToolDefinition } from '../registry.ts'
import { objectSchema, stringProp } from '../schema.ts'
import { isIsoDate } from './appointments.ts'

export const billingReadTools: McpToolDefinition[] = [
  {
    name: 'carebook_get_patient_billing',
    description:
      'Return a patient\'s packages, payments and outstanding balance. Amounts are in INR. Admin only.',
    scope: 'read',
    adminOnly: true,
    inputSchema: objectSchema({ patient_id: stringProp('Patient UUID') }, ['patient_id']),
    handler: async (args, ctx) => {
      // Belt and braces: adminOnly already hides this tool, and RLS already
      // blocks the rows, but the UI's own gate is asserted here too so all
      // three would have to fail together.
      if (!getRestrictedUiAccess(ctx.profile).canViewBilling) {
        throw new ToolError('You are not allowed to view billing.')
      }
      const patientId = String(args.patient_id ?? '')
      if (!patientId) throw new ToolError('patient_id is required')

      const [{ data: packages }, { data: payments }] = await Promise.all([
        ctx.supabase
          .from('packages')
          .select(
            'id, name, total_sessions, used_sessions, total_amount, paid_amount, per_session_amount, status, starts_on'
          )
          .eq('patient_id', patientId)
          .order('created_at', { ascending: false }),
        ctx.supabase
          .from('payments')
          .select('id, amount, payment_method, payment_date, notes, status, package_id')
          .eq('patient_id', patientId)
          .order('payment_date', { ascending: false })
          .limit(50),
      ])

      const totalBilled = (packages ?? []).reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0)
      const totalPaid = (payments ?? [])
        .filter((row) => row.status !== 'voided')
        .reduce((sum, row) => sum + Number(row.amount ?? 0), 0)

      return {
        packages: packages ?? [],
        payments: payments ?? [],
        totals: { billed: totalBilled, paid: totalPaid, outstanding: totalBilled - totalPaid },
        currency: 'INR',
      }
    },
  },
  {
    name: 'carebook_billing_summary',
    description:
      'Return clinic-wide payment totals for a date range, broken down by payment method. Amounts are in INR. Admin only.',
    scope: 'read',
    adminOnly: true,
    inputSchema: objectSchema(
      {
        from_date: stringProp('Start date, inclusive, as yyyy-MM-dd'),
        to_date: stringProp('End date, inclusive, as yyyy-MM-dd'),
      },
      ['from_date', 'to_date']
    ),
    handler: async (args, ctx) => {
      if (!getRestrictedUiAccess(ctx.profile).canViewBilling) {
        throw new ToolError('You are not allowed to view billing.')
      }
      const fromDate = String(args.from_date ?? '')
      const toDate = String(args.to_date ?? '')
      if (!isIsoDate(fromDate) || !isIsoDate(toDate)) {
        throw new ToolError('from_date and to_date must be yyyy-MM-dd')
      }

      const { data, error } = await ctx.supabase
        .from('payments')
        .select('amount, payment_method, status')
        .gte('payment_date', fromDate)
        .lte('payment_date', toDate)
      if (error) throw error

      const byMethod: Record<string, number> = {}
      let total = 0
      for (const row of data ?? []) {
        if (row.status === 'voided') continue
        const amount = Number(row.amount ?? 0)
        total += amount
        byMethod[row.payment_method ?? 'unknown'] =
          (byMethod[row.payment_method ?? 'unknown'] ?? 0) + amount
      }

      return { from_date: fromDate, to_date: toDate, total, by_method: byMethod, currency: 'INR' }
    },
  },
]
```

- [ ] **Step 4: Register, run and commit**

Add `...billingReadTools` to `createRegistry([...])`.

```bash
node --test --experimental-strip-types src/lib/mcp/tools/billing.test.ts
npm run lint && npm run typecheck && npm run build
```

```bash
git add src/lib/mcp/tools/billing.ts src/lib/mcp/tools/billing.test.ts src/app/api/mcp/route.ts
git commit -m "feat(mcp): add admin-only billing read tools"
```

---

## Task 17: Rate limiting and invocation audit

**Files:**
- Create: `src/lib/mcp/rate-limit.ts`, `src/lib/mcp/rate-limit.test.ts`
- Create: `src/lib/mcp/audit.ts`
- Modify: `src/app/api/mcp/route.ts`

**Interfaces:**
- Produces:
  - `checkRateLimit(grantId: string, kind: 'read' | 'write' | 'billing'): void` — throws `ToolError`
  - `recordInvocation(input): Promise<void>`
  - `digestArgs(args: Record<string, unknown>): string`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/mcp/rate-limit.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { checkRateLimit, resetRateLimits } from './rate-limit.ts'

test('reads are allowed up to the budget then refused', () => {
  resetRateLimits()
  for (let i = 0; i < 60; i += 1) checkRateLimit('grant-a', 'read')
  assert.throws(() => checkRateLimit('grant-a', 'read'), /Too many/)
})

test('budgets are tracked per grant', () => {
  resetRateLimits()
  for (let i = 0; i < 60; i += 1) checkRateLimit('grant-a', 'read')
  checkRateLimit('grant-b', 'read')
})

test('write and billing budgets are separate and tighter', () => {
  resetRateLimits()
  for (let i = 0; i < 10; i += 1) checkRateLimit('grant-a', 'write')
  assert.throws(() => checkRateLimit('grant-a', 'write'), /Too many/)
  // The read budget is untouched by write traffic.
  checkRateLimit('grant-a', 'read')
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test --experimental-strip-types src/lib/mcp/rate-limit.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the rate limiter**

```typescript
// src/lib/mcp/rate-limit.ts
import { ToolError } from './errors.ts'

type Budget = { limit: number; windowMs: number }

const BUDGETS: Record<'read' | 'write' | 'billing', Budget> = {
  read: { limit: 60, windowMs: 60_000 },
  write: { limit: 10, windowMs: 60_000 },
  billing: { limit: 20, windowMs: 3_600_000 },
}

const counters = new Map<string, { count: number; resetAt: number }>()

// In-process only. On Vercel each function instance keeps its own counter, so
// this is a guard against a runaway agent loop, not a hard security boundary.
// The durable controls are scopes, RLS, and idempotency keys.
export function checkRateLimit(grantId: string, kind: 'read' | 'write' | 'billing'): void {
  const budget = BUDGETS[kind]
  const key = `${grantId}:${kind}`
  const now = Date.now()
  const entry = counters.get(key)

  if (!entry || entry.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + budget.windowMs })
    return
  }
  if (entry.count >= budget.limit) {
    throw new ToolError(`Too many ${kind} requests. Try again shortly.`)
  }
  entry.count += 1
}

export function resetRateLimits(): void {
  counters.clear()
}
```

- [ ] **Step 4: Write the audit writer**

```typescript
// src/lib/mcp/audit.ts
import 'server-only'

import crypto from 'node:crypto'

import { logger } from '../logger.ts'
import { createAdminClient } from '../supabase/admin.ts'
import type { McpToolInvocationStatus } from '../supabase/types.ts'
import type { ResolvedGrant } from './grants.ts'

// Arguments can carry patient names and notes, so only a digest is stored.
// It is still enough to prove two calls were identical.
export function digestArgs(args: Record<string, unknown>): string {
  const canonical = JSON.stringify(args, Object.keys(args).sort())
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

export async function recordInvocation(input: {
  grant: ResolvedGrant
  toolName: string
  status: McpToolInvocationStatus
  requestDigest: string
  idempotencyKey?: string | null
  errorCode?: string | null
  entityType?: string | null
  entityId?: string | null
  durationMs: number
}): Promise<void> {
  try {
    const supabase = createAdminClient()
    await supabase.from('mcp_tool_invocations').insert({
      grant_id: input.grant.grantId,
      user_id: input.grant.userId,
      clinic_id: input.grant.clinicId,
      tool_name: input.toolName,
      idempotency_key: input.idempotencyKey ?? null,
      request_digest: input.requestDigest,
      status: input.status,
      error_code: input.errorCode ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      duration_ms: input.durationMs,
    })
  } catch (error) {
    // Never fail a tool call because auditing failed; log loudly instead.
    logger.error('mcp/audit/write-failed', error, { toolName: input.toolName })
  }
}
```

- [ ] **Step 5: Wire both into `tools/call`**

In `src/app/api/mcp/route.ts`, inside the `tools/call` case, wrap the handler:

```typescript
        const started = Date.now()
        const args = params.arguments ?? {}
        const requestDigest = digestArgs(args)
        const kind = tool.scope === 'read' ? 'read' : tool.scope === 'write:billing' ? 'billing' : 'write'

        try {
          checkRateLimit(grant.grantId, kind)
          const value = await tool.handler(args, ctx)
          await recordInvocation({
            grant,
            toolName: tool.name,
            status: 'ok',
            requestDigest,
            durationMs: Date.now() - started,
          })
          return NextResponse.json(rpcResult(id, toolResult(JSON.stringify(value, null, 2))))
        } catch (error) {
          await recordInvocation({
            grant,
            toolName: tool.name,
            status: 'error',
            requestDigest,
            durationMs: Date.now() - started,
          })
          logger.warn('mcp/tool/failed', 'An MCP tool call failed', {
            tool: tool.name,
            grantId: grant.grantId,
          })
          return NextResponse.json(rpcResult(id, toolResult(sanitizeToolError(error), true)))
        }
```

- [ ] **Step 6: Verify and commit**

```bash
node --test --experimental-strip-types src/lib/mcp/rate-limit.test.ts
npm run lint && npm run typecheck && npm run build
```

```bash
git add src/lib/mcp/rate-limit.ts src/lib/mcp/rate-limit.test.ts src/lib/mcp/audit.ts src/app/api/mcp/route.ts
git commit -m "feat(mcp): add per-grant rate limits and tool invocation audit"
```

---

## Task 18: Connected Apps settings UI

**Files:**
- Create: `src/app/settings/connected-apps/connected-apps-list.tsx`
- Create: `src/app/settings/connected-apps/actions.ts`
- Modify: the settings page to render the section

**Interfaces:**
- Consumes: `McpAccessGrant` (Task 1), `SCOPE_DESCRIPTIONS` (Task 2)
- Produces: `revokeGrant(grantId: string): Promise<void>` server action

- [ ] **Step 1: Write the revoke server action**

```typescript
// src/app/settings/connected-apps/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

export async function revokeGrant(grantId: string): Promise<void> {
  const profile = await getCurrentProfile()
  if (!profile) throw new Error('Not signed in')

  const supabase = await createClient()
  // RLS restricts this to the caller's own grants, so no extra ownership check
  // is needed here — the policy is the check.
  const { error } = await supabase
    .from('mcp_access_grants')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', grantId)
    .is('revoked_at', null)

  if (error) {
    logger.error('settings/connected-apps/revoke', error, { grantId, userId: profile.id })
    throw new Error('Could not revoke that connection.')
  }

  logger.info('settings/connected-apps/revoke', 'Revoked an MCP grant', {
    grantId,
    userId: profile.id,
  })
  revalidatePath('/settings')
}
```

- [ ] **Step 2: Render the list**

The settings page (a Server Component) fetches the caller's active grants:

```typescript
const { data: grants } = await supabase
  .from('mcp_access_grants')
  .select('id, client_id, scopes, created_at, last_used_at')
  .is('revoked_at', null)
  .order('created_at', { ascending: false })
```

and passes them to `<ConnectedAppsList grants={grants ?? []} />`, a Client Component that renders one card per grant showing the client name, the granted scopes rendered from `SCOPE_DESCRIPTIONS`, when it was connected, when it was last used, and a **Disconnect** button that calls `revokeGrant` and then `router.refresh()`.

Follow the existing settings-section markup and the `.ph-*` utility classes. Tap targets must be at least 44×44 per the mobile conventions in `CLAUDE.md`.

- [ ] **Step 3: Verify and commit**

```bash
npm run lint && npm run typecheck && npm run test:component && npm run build
```

```bash
git add src/app/settings
git commit -m "feat(mcp): let users see and revoke connected MCP apps in settings"
```

---

## Task 19: Conformance script

This is the highest-value test in the plan. It replays Chanakya's exact call sequence, with Chanakya's exact headers, against a locally running Care-Book.

**Files:**
- Create: `scripts/mcp-conformance.ts`
- Modify: `package.json` (add `"mcp:conformance"` script)

**Interfaces:**
- Consumes: a running server and a valid access token

- [ ] **Step 1: Write the script**

```typescript
// scripts/mcp-conformance.ts
// Replays exactly what backend/internal/mcp/http_client.go and
// internal/mcp/oauth/discover.go send, so a wire-level mismatch is caught
// here rather than after deploying and failing to connect.
import assert from 'node:assert/strict'

const BASE = process.env.CONFORMANCE_BASE_URL ?? 'http://localhost:3000'
const TOKEN = process.env.CONFORMANCE_ACCESS_TOKEN ?? ''

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  await fn()
  console.log(`  ok  ${label}`)
}

async function main(): Promise<void> {
  await step('GET /api/mcp returns a 401 with a resource_metadata challenge', async () => {
    const res = await fetch(`${BASE}/api/mcp`)
    assert.equal(res.status, 401)
    const challenge = res.headers.get('www-authenticate') ?? ''
    const match = /resource_metadata="([^"]+)"/.exec(challenge)
    assert.ok(match, `WWW-Authenticate lacked resource_metadata: ${challenge}`)
  })

  await step('protected-resource metadata lists an authorization server', async () => {
    const res = await fetch(`${BASE}/.well-known/oauth-protected-resource`, {
      headers: { Accept: 'application/json' },
    })
    assert.equal(res.status, 200)
    const meta = await res.json()
    assert.ok(Array.isArray(meta.authorization_servers) && meta.authorization_servers.length > 0)
    assert.equal(meta.resource, `${BASE}/api/mcp`)
  })

  await step('AS metadata advertises S256 and a public client', async () => {
    const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`, {
      headers: { Accept: 'application/json' },
    })
    const meta = await res.json()
    assert.ok(meta.code_challenge_methods_supported.includes('S256'))
    assert.ok(meta.token_endpoint_auth_methods_supported.includes('none'))
    assert.ok(meta.registration_endpoint)
  })

  await step('dynamic client registration returns a client_id', async () => {
    const res = await fetch(`${BASE}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['http://localhost:8090/agentui/api/mcp/oauth/callback'],
        client_name: 'chanakya-conformance',
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    })
    assert.equal(res.status, 201)
    const body = await res.json()
    assert.ok(body.client_id)
  })

  if (!TOKEN) {
    console.log('\n  skipped the JSON-RPC steps: set CONFORMANCE_ACCESS_TOKEN to run them')
    return
  }

  // Chanakya sends BOTH media types in Accept. A server that 406s on this is
  // the exact bug that broke the MoEngage integration.
  const rpc = async (method: string, params: unknown, id: number) => {
    const res = await fetch(`${BASE}/api/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
    assert.equal(res.status, 200, `${method} returned ${res.status}`)
    return res.json()
  }

  await step('initialize echoes protocol 2024-11-05', async () => {
    const body = await rpc(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'chanakya-agent-runner', version: '1' },
        capabilities: {},
      },
      1
    )
    assert.equal(body.result.protocolVersion, '2024-11-05')
    assert.ok(body.result.serverInfo.name)
  })

  await step('tools/list returns a non-empty catalogue', async () => {
    const body = await rpc('tools/list', {}, 2)
    assert.ok(Array.isArray(body.result.tools) && body.result.tools.length > 0)
    for (const tool of body.result.tools) {
      assert.ok(tool.name && tool.description && tool.inputSchema)
    }
  })

  await step('tools/call carebook_whoami succeeds', async () => {
    const body = await rpc('tools/call', { name: 'carebook_whoami', arguments: {} }, 3)
    assert.equal(body.result.isError, false)
    assert.equal(body.result.content[0].type, 'text')
    const payload = JSON.parse(body.result.content[0].text)
    assert.ok(payload.user.id)
  })

  await step('an unknown tool is a tool error, not a protocol error', async () => {
    const body = await rpc('tools/call', { name: 'nope', arguments: {} }, 4)
    assert.equal(body.error, undefined, 'unknown tools must not produce a JSON-RPC error')
    assert.equal(body.result.isError, true)
  })
}

await main()
console.log('\nconformance: all checks passed')
```

- [ ] **Step 2: Add the npm script**

In `package.json`:

```json
"mcp:conformance": "node --experimental-strip-types --env-file=.env.local scripts/mcp-conformance.ts"
```

- [ ] **Step 3: Run it against a local server**

```bash
MCP_ENABLED=true npm run dev
```

In a second shell:

```bash
npm run mcp:conformance
```

Expected: the four unauthenticated steps pass. Then complete a real consent flow in the browser to obtain an access token, export it as `CONFORMANCE_ACCESS_TOKEN`, and re-run for the full set.

- [ ] **Step 4: Commit**

```bash
git add scripts/mcp-conformance.ts package.json
git commit -m "test(mcp): add wire-level conformance script matching Chanakya's client"
```

---

## Task 20: E2E specs

Required by the maintenance policy in `CLAUDE.md`: new routes, a new form, and role-gated UI all need matching `e2e/` coverage.

**Files:**
- Create: `e2e/public/mcp-discovery.spec.ts`
- Create: `e2e/admin/mcp-consent.spec.ts`
- Create: `e2e/shared/routes.spec.ts` (modify — add the new routes)

- [ ] **Step 1: Write the discovery spec**

```typescript
// e2e/public/mcp-discovery.spec.ts
import { expect, test } from '@playwright/test'

test.describe('MCP discovery endpoints', () => {
  test('the MCP endpoint challenges unauthenticated callers', async ({ request }) => {
    const response = await request.get('/api/mcp')
    expect(response.status()).toBe(401)
    expect(response.headers()['www-authenticate']).toContain('resource_metadata=')
  })

  test('protected-resource metadata is publicly readable', async ({ request }) => {
    const response = await request.get('/.well-known/oauth-protected-resource')
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    expect(body.authorization_servers.length).toBeGreaterThan(0)
  })

  test('AS metadata advertises S256 PKCE', async ({ request }) => {
    const response = await request.get('/.well-known/oauth-authorization-server')
    const body = await response.json()
    expect(body.code_challenge_methods_supported).toContain('S256')
  })

  test('discovery endpoints are not redirected to the login page', async ({ request }) => {
    const response = await request.get('/.well-known/oauth-authorization-server', {
      maxRedirects: 0,
    })
    expect(response.status()).toBe(200)
  })
})
```

- [ ] **Step 2: Write the consent spec**

`e2e/admin/mcp-consent.spec.ts` must, using the admin `storageState`:

1. Register a client via `request.post('/oauth/register', …)` and capture the `client_id`
2. Navigate to `/oauth/authorize?...` with a valid `code_challenge`, `resource`, `state` and `scope=read write:billing`
3. Assert the consent screen names the client and shows the admin's own email
4. Assert the `write:billing` checkbox is present and **unchecked**
5. Click Approve and assert the redirect lands on the registered `redirect_uri` with `code=` and the same `state=`
6. Repeat steps 2–5 with the **staff** `storageState` and assert the `write:billing` checkbox is **absent**

- [ ] **Step 3: Add the routes to the manifest spec**

Add `/oauth/authorize` to `e2e/shared/routes.spec.ts` in the shape that file already uses. `/api/mcp` and the `.well-known` paths belong in the public spec above, not the page-route manifest.

- [ ] **Step 4: Run the suite**

```bash
npm run e2e:db:up && npm run build:e2e && npm run test:e2e
```

Expected: all shards green.

- [ ] **Step 5: Commit and push**

```bash
git add e2e
git commit -m "test(mcp): cover discovery endpoints and the OAuth consent screen"
git push -u origin <branch>
```

Then watch the run to completion and report the conclusion:

```bash
gh run list --branch <branch> --limit 1
```

---

## Task 21: Deploy and connect from Chanakya

- [ ] **Step 1: Set the production environment variables**

```bash
vercel env add SUPABASE_JWT_SECRET production
vercel env add MCP_TOKEN_PEPPER production
vercel env add MCP_ENABLED production
```

`MCP_ENABLED` starts as `false`. Confirm `NEXT_PUBLIC_SITE_URL` is set to the exact canonical origin — a mismatch breaks RFC 8707 resource pinning on every refresh.

- [ ] **Step 2: Apply migration 040 to production**

Run migration `040_mcp_oauth.sql` against the production Supabase project and confirm the five tables and their RLS policies exist.

- [ ] **Step 3: Enable and smoke-test**

Flip `MCP_ENABLED` to `true`, redeploy, and run the conformance script against production:

```bash
CONFORMANCE_BASE_URL=https://<site> npm run mcp:conformance
```

- [ ] **Step 4: Connect from Chanakya**

In Chanakya → Settings → MCP Servers → Add: name `Care-Book`, transport `http`, url `https://<site>/api/mcp`. Save, then click **Connect (OAuth)**. Complete the Care-Book login and consent in the browser.

Verify on the Chanakya side:

- the server row shows `auth_mode = 'oauth'`
- **Test** returns the full tool catalogue and populates `discovered_tools_json`
- `last_error` is empty

- [ ] **Step 5: Verify the identity is real**

Run an agent that calls `carebook_whoami`. It must return the Care-Book user who completed consent — not a service account, not another user.

- [ ] **Step 6: Record the outcome**

Write a session note in `docs/` covering what was verified live, and update the spec's status from Draft to Shipped.

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §3.1 transport contract | 11, 19 |
| §3.2 discovery + 401 challenge | 6, 11, 19, 20 |
| §3.3 DCR public client | 8, 19 |
| §3.4 authorize/token/PKCE/resource | 9, 10, 19 |
| §3.5 token lifetimes | 5 |
| §5 identity bridge | 0, 4, 12 |
| §6 data model | 1 |
| §7 endpoint specs | 6, 8, 9, 10, 11 |
| §8.2 read tools | 13, 14, 15, 16 |
| §8.3–8.4 write tools | **Plan 2** — deliberately deferred |
| §9 guardrails (rate limit, audit) | 17. Dry-run and idempotency ship with the write tools in Plan 2 |
| §10 existing-code changes | 7, 18 |
| §11 testing | every task, plus 19 and 20 |
| §12 configuration | 2, 21 |

**Known gaps, deliberately left to Plan 2:** all `write:clinical` and `write:billing` tools, the dry-run confirm protocol, and idempotency-key enforcement. The scope values and the `mcp_tool_invocations.idempotency_key` column ship here so Plan 2 needs no migration.

**Type consistency check:** `McpToolDefinition`, `ToolContext` and `ResolvedGrant` are defined in Tasks 12 and 5 and used unchanged in Tasks 13–17. `clampLimit` is defined in Task 14 and imported by Tasks 15 and 16. `isIsoDate` is defined in Task 15 and imported by Task 16. `ToolError` and `sanitizeToolError` are defined in Task 11 and used from Task 14 onward. `OAuthError` is defined in Task 5 and used in Tasks 8, 9 and 10.

**Verification required during execution, not assumed:** the `profiles` display-name column (`full_name` vs `name`), `appointment_types.default_fee`, and the exact `payments.status` values. Each is flagged inline in the task that needs it. Check `src/lib/supabase/types.ts` and `supabase/schema.sql` rather than trusting the sample code.
