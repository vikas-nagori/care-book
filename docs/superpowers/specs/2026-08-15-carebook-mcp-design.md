# Care-Book MCP Server — Design

**Date:** 2026-08-15
**Status:** Draft for review
**Scope:** Expose Care-Book to Chanakya (and any other MCP client) as a remote,
OAuth-protected MCP server. Full read + write tool surface, including billing.

---

## 1. Summary

Care-Book gains two new capabilities:

1. **An MCP server** at `POST /api/mcp` — stateless JSON-RPC, protocol
   `2024-11-05`, exposing patients, schedule, clinical notes and billing as tools.
2. **An OAuth 2.1 authorization server** on top of Supabase Auth, so a Chanakya
   user can link *their own* Care-Book account by consent, exactly the way a
   Claude user links a Google account.

**All new code lands in Care-Book. Chanakya needs zero changes.** Chanakya
already shipped a spec-compliant generic OAuth 2.1 MCP client (backend
`internal/mcp/oauth/`, migration `000052`), proven end to end against
`mcp.moengage.com` on 2026-07-01. Care-Book's job is to be a server that client
already knows how to talk to.

The end-user flow:

```
Chanakya Settings → MCP Servers → Add
  name: Care-Book
  transport: http
  url: https://<care-book-host>/api/mcp
→ click "Connect (OAuth)"
→ browser opens Care-Book → Supabase login (if needed) → consent screen
→ back to Chanakya, connected
→ agent now has mcp__care_book__carebook_* tools, scoped to that one
  Care-Book user, their clinic, and their role
```

Two separate identities, joined only by a stored grant: a Chanakya `user_id`
holds a token that maps to a Care-Book `profiles.id`. Neither system needs to
know the other's password, and either side can revoke independently.

---

## 2. Why this shape

Chanakya supports two integration patterns. We take the second.

### Rejected: managed local sidecar (the WhatsApp / Google Workspace pattern)

`services/whatsapp-mcp` is a Node service bound to `127.0.0.1`, protected by a
shared bearer token, receiving `X-Chanakya-User-Id` as a header and keeping its
own per-user account binding. Chanakya carries a bespoke
`managed_whatsapp_mcp_handler.go` and a `managed_key` column for it.

Rejected because:

- It requires first-party Chanakya code (a new `managed_care_book_mcp_handler.go`,
  a new managed key, new frontend rows) for every integration.
- It trusts a header for identity. That is only safe because the sidecar is
  localhost-only and same-host. Care-Book is on Vercel; a header-trust model
  across the public internet is not acceptable for patient data.
- Care-Book already *has* a login. Duplicating account binding inside a sidecar
  would mean a second credential store for the same users.

### Chosen: remote MCP server with OAuth 2.1 + PKCE

Chanakya's `internal/mcp/oauth/` implements RFC 9728 protected-resource
discovery, RFC 8414 AS metadata (with OIDC fallback), RFC 7591 dynamic client
registration, RFC 7636 PKCE S256, and RFC 8707 resource pinning. If Care-Book
speaks those, the integration is configuration, not code.

This also matches the requirement directly: **Care-Book users authenticate to
Care-Book; Chanakya users authenticate to Chanakya; a consent screen links one
to the other.**

Benefits beyond Chanakya: the same server works with Claude Desktop, Claude
Code, or any other MCP client, because nothing about it is Chanakya-specific.

---

## 3. The wire contract Chanakya imposes

These are not guesses — they are read off the Chanakya source. Care-Book must
match them exactly or the connection silently fails.

### 3.1 Transport (`backend/internal/mcp/http_client.go`)

| Property | Value | Consequence for Care-Book |
|---|---|---|
| Method | `POST` to the configured URL | One route handler, no session endpoints |
| Framing | Unary JSON-RPC 2.0, one request → one response body | **No** Streamable-HTTP session IDs, no `GET` SSE channel needed |
| `protocolVersion` | `2024-11-05` | Echo this back from `initialize` |
| `clientInfo` | `{"name":"chanakya-agent-runner","version":"1"}` | — |
| `Accept` | `application/json, text/event-stream` | Handler must not 406 on this |
| Response | JSON body, or SSE-framed (`extractJSONFromSSE` unwraps it) | Plain JSON is fine and simpler |
| Timeout | 30 s | Every tool must return well inside 30 s |
| Auth | `Authorization: <auth_header value>` verbatim, populated as `"Bearer <token>"` | Standard bearer |

Methods actually called: `initialize`, `tools/list`, `tools/call`. Nothing else.

This is a much smaller surface than full MCP Streamable HTTP, and it is a
perfect fit for a stateless Vercel function.

### 3.2 Discovery (`backend/internal/mcp/oauth/discover.go`)

`DiscoverProtectedResource` first does an unauthenticated `GET` on the **server
URL itself** and reads `WWW-Authenticate` for `resource_metadata="..."`. Only if
that fails does it fall back to appending `/.well-known/oauth-protected-resource`
to the full URL (i.e. `…/api/mcp/.well-known/…` — an awkward path we should
avoid depending on).

⇒ **`GET /api/mcp` must return `401` with:**

```
WWW-Authenticate: Bearer resource_metadata="https://<site>/.well-known/oauth-protected-resource"
```

`DiscoverAuthorizationServer(issuer)` appends `/.well-known/oauth-authorization-server`
to the issuer string, falling back to `/.well-known/openid-configuration`.

⇒ **Set `issuer` to the bare site origin** (`https://<site>`), so the metadata
lands at `https://<site>/.well-known/oauth-authorization-server`.

### 3.3 Registration (`register.go`)

Chanakya sends RFC 7591 DCR with `token_endpoint_auth_method: "none"` **if and
only if** our metadata advertises `"none"` in `token_endpoint_auth_methods_supported`;
otherwise it asks for `client_secret_post`.

⇒ Advertise `"none"` and register Chanakya as a **public, PKCE-only client**. No
client secret to store or rotate on either side. It sends
`grant_types: ["authorization_code","refresh_token"]`, `response_types: ["code"]`,
and one `redirect_uris` entry.

If `registration_endpoint` is absent it returns `ErrDCRUnsupported` and falls
back to `MCP_OAUTH_<SLUG>_CLIENT_ID` env vars. We support DCR so this branch
never fires.

### 3.4 Authorization & token (`flow.go`)

`BuildAuthorizeURL` always sends: `response_type=code`, `client_id`,
`redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`,
`resource`, and space-joined `scope`.

`ExchangeCode` posts form-encoded `grant_type=authorization_code`, `code`,
`redirect_uri`, `client_id`, `code_verifier`, `resource`. **No Basic auth** for a
public client.

`RefreshAccessToken` posts `grant_type=refresh_token`, `refresh_token`,
`client_id`, `resource` — re-pinning `resource` on every refresh.

Expected token response (`types.go`, RFC 6749 §5.1):

```json
{ "access_token": "...", "token_type": "Bearer", "expires_in": 3600,
  "refresh_token": "...", "scope": "read write:clinical write:billing" }
```

If `expires_in` is omitted Chanakya assumes 55 minutes. We always send it.

### 3.5 Refresh worker (`oauth/worker.go`)

Chanakya proactively refreshes within a 5-minute window before expiry, sweeping
every 120 s. An access-token lifetime of **1 hour** is comfortable. Refresh
tokens must survive far longer — **30 days, rotating on each use**.

### 3.6 Redirect URI

The live Chanakya callback (confirmed in the 2026-07-01 session record):

```
https://mdpinas.tail23e25d.ts.net/agentui/api/mcp/oauth/callback
```

DCR carries it, so Care-Book stores whatever the client registers. We must not
hardcode it, but we **must** validate exact-match at both `/oauth/authorize` and
`/oauth/token`.

---

## 4. Architecture

```
┌─ Chanakya (Raspberry Pi, Go) ──────────────┐
│  internal/mcp/oauth      ← OAuth client    │
│  internal/mcp/http_client← JSON-RPC client │
│  mcp_servers row (transport=http,          │
│    auth_mode=oauth, url=…/api/mcp)         │
└───────────────┬────────────────────────────┘
                │  HTTPS
                ▼
┌─ Care-Book (Next.js on Vercel) ────────────────────────────┐
│                                                             │
│  /.well-known/oauth-protected-resource   RFC 9728           │
│  /.well-known/oauth-authorization-server RFC 8414           │
│  /oauth/register    DCR       (public)                      │
│  /oauth/authorize   consent   (Supabase session required)   │
│  /oauth/token       code→token, refresh                     │
│  /oauth/revoke      RFC 7009                                │
│  /api/mcp           JSON-RPC: initialize/tools/list/call    │
│  /settings#connected-apps  user-facing grant management     │
│                                                             │
│  src/lib/mcp/                                               │
│    ├── jsonrpc.ts      framing + error codes                │
│    ├── tools/          one module per tool group            │
│    ├── registry.ts     name → {schema, scope, handler}      │
│    ├── identity.ts     grant → Supabase user client  ★      │
│    ├── tokens.ts       mint / hash / verify opaque tokens   │
│    └── guardrails.ts   scopes, idempotency, dry-run, limits │
│                                                             │
│  supabase/migrations/039_mcp_oauth.sql                      │
└───────────────┬─────────────────────────────────────────────┘
                │  PostgREST, as the *end user*
                ▼
        Supabase Postgres — existing RLS unchanged
```

★ `identity.ts` is the crux of the whole design. Section 5.

---

## 5. The identity bridge (the crux)

### 5.1 Why service-role does not work

Care-Book's entire authorization model hangs off `auth.uid()`:

- `public.has_role(text[])` (migration 005) reads
  `select … from profiles where id = auth.uid()`.
- `record_payment_v2` (migration 038) is `security definer` and opens with
  `if not private.has_role(array['admin']) then raise exception … 42501`.
- Migration 034 adds a check constraint requiring
  `creation_origin in ('rpc','historical_correction') ⇒ created_by is not null`,
  where `created_by` comes from `auth.uid()`.
- The audit ledger (031/032) stamps `auth.uid()` on refunds, voids,
  cancellations and fee adjustments.

Under `createAdminClient()` (service role) `auth.uid()` is `NULL`. Billing
writes would be **rejected outright** by `has_role`, and if they somehow
weren't, they would violate the audit constraint. Service-role is not merely
less safe here — it does not function.

It would also mean re-implementing every RLS policy in TypeScript and keeping
the two in sync forever. That is exactly the class of bug the current security
review branch exists to fix.

### 5.2 Chosen approach — mint a short-lived Supabase user JWT

Per MCP request:

1. Read `Authorization: Bearer cbk_at_…`, SHA-256 it, look up `mcp_access_grants`.
2. Check `revoked_at is null` and `access_expires_at > now()`.
3. Mint an HS256 JWT signed with `SUPABASE_JWT_SECRET`:

```json
{
  "sub":  "<profiles.id / auth.users.id>",
  "role": "authenticated",
  "aud":  "authenticated",
  "email": "<user email>",
  "iat":  <now>,
  "exp":  <now + 60s>,
  "app_metadata": { "provider": "mcp" },
  "user_metadata": {}
}
```

4. Build a client with the **anon** key and that JWT as the `Authorization`
   header, and run every query and RPC through it.

Result: RLS applies untouched, `auth.uid()` is the real user, `has_role` works,
and the billing ledger attributes actions to the actual person — with an
`mcp_tool_invocations` row proving it arrived via MCP.

The JWT lives 60 seconds and never leaves the server process.

### 5.3 Risk: the secret may not exist

`SUPABASE_JWT_SECRET` is not currently in `.env.local` or `.env.e2e`. It is
available in the Supabase dashboard **only for projects still on the legacy
symmetric (HS256) JWT secret**. Projects migrated to asymmetric signing keys
(ES256/JWKS) cannot mint tokens this way — the private key is not exportable.

**This is verified by a spike before anything else is built** (Phase 0 of the
plan). Two outcomes:

- **Legacy HS256 available** → proceed as above.
- **Asymmetric only** → fallback: capture the user's Supabase **refresh token**
  during consent (we have a live session on that page), store it AES-GCM
  encrypted, and call `auth.refreshSession()` per MCP session to obtain a real
  access token. Same RLS guarantees. Costs: refresh-token rotation must be
  serialised per grant, and a user signing out everywhere kills the link.
  Documented as Plan B, not built unless needed.

### 5.4 Role is not re-derived, it is inherited

An MCP grant can never exceed the linked user's own permissions. A staff user's
token gets staff visibility because `has_role` and RLS say so — not because our
tool code checks. Scopes (§8.1) can only *narrow* that further.

`getAppointmentVisibilityFilter(profile)` and `getRestrictedUiAccess(profile)`
are still applied in the tool layer, so MCP output matches what the same user
would see in the UI. That is defence in depth, not the primary control.

---

## 6. Data model — `supabase/migrations/039_mcp_oauth.sql`

Four tables, all with RLS on. Numeric prefix 039 is free and unique (required —
the Supabase CLI keys migrations by prefix).

```sql
-- Dynamically registered OAuth clients (RFC 7591). One row per MCP client
-- installation, e.g. one Chanakya instance.
create table public.mcp_oauth_clients (
  id                         uuid primary key default gen_random_uuid(),
  client_id                  text not null unique,
  client_name                text,
  redirect_uris              text[] not null,
  token_endpoint_auth_method text not null default 'none',
  client_secret_hash         text,          -- null for public clients
  created_at                 timestamptz not null default now(),
  constraint mcp_oauth_clients_secret_check check (
    (token_endpoint_auth_method = 'none' and client_secret_hash is null)
    or (token_endpoint_auth_method <> 'none' and client_secret_hash is not null)
  )
);

-- Single-use authorization codes. 60s TTL, deleted on redemption so a
-- replayed callback cannot re-issue tokens.
create table public.mcp_authorization_codes (
  id             uuid primary key default gen_random_uuid(),
  code_hash      text not null unique,
  client_id      text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  clinic_id      uuid not null references public.clinics(id) on delete cascade,
  scopes         text[] not null,
  code_challenge text not null,             -- S256 only
  redirect_uri   text not null,
  resource       text not null,             -- RFC 8707 pin
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

-- A live link between one MCP client and one Care-Book user.
create table public.mcp_access_grants (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  clinic_id          uuid not null references public.clinics(id) on delete cascade,
  client_id          text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  scopes             text[] not null,
  resource           text not null,
  access_token_hash  text not null unique,
  refresh_token_hash text unique,
  access_expires_at  timestamptz not null,
  refresh_expires_at timestamptz,
  last_used_at       timestamptz,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now()
);
create index idx_mcp_grants_user_active
  on public.mcp_access_grants(user_id) where revoked_at is null;

-- Every tool call. Doubles as the idempotency ledger for money-moving tools
-- and as the MCP-origin audit trail the billing tables cannot carry
-- (their creation_origin enum is fixed by migration 034's check constraint).
create table public.mcp_tool_invocations (
  id              uuid primary key default gen_random_uuid(),
  grant_id        uuid not null references public.mcp_access_grants(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  tool_name       text not null,
  idempotency_key text,
  request_digest  text not null,            -- sha256 of canonical args, never raw PHI
  status          text not null check (status in ('ok','error','denied','dry_run')),
  error_code      text,
  entity_type     text,                     -- 'payment' | 'appointment' | …
  entity_id       uuid,
  duration_ms     integer,
  created_at      timestamptz not null default now()
);
create unique index idx_mcp_invocations_idempotency
  on public.mcp_tool_invocations(grant_id, idempotency_key)
  where idempotency_key is not null and status = 'ok';
```

**RLS:** users may `select` their own `mcp_access_grants` and
`mcp_tool_invocations` and `update` their own grants to set `revoked_at`
(that is what powers the Connected Apps UI). Everything else is service-role
only — the OAuth endpoints run before a user session exists, so they use
`createAdminClient()`. Clinic admins may read invocations for their clinic.

**Token format:** 32 random bytes, base64url, prefixed `cbk_at_` / `cbk_rt_`.
Only SHA-256 digests are stored. Codes are hashed the same way.

**Lifetimes:** authorization code 60 s · access token 1 h · refresh token 30 d
with rotation on every use (old digest replaced atomically in the same
transaction).

---

## 7. Endpoint specifications

### 7.1 `GET /.well-known/oauth-protected-resource`

```json
{
  "resource": "https://<site>/api/mcp",
  "authorization_servers": ["https://<site>"],
  "scopes_supported": ["read", "write:clinical", "write:billing"],
  "bearer_methods_supported": ["header"]
}
```

### 7.2 `GET /.well-known/oauth-authorization-server`

```json
{
  "issuer": "https://<site>",
  "authorization_endpoint": "https://<site>/oauth/authorize",
  "token_endpoint": "https://<site>/oauth/token",
  "registration_endpoint": "https://<site>/oauth/register",
  "revocation_endpoint": "https://<site>/oauth/revoke",
  "scopes_supported": ["read", "write:clinical", "write:billing"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "response_types_supported": ["code"],
  "token_endpoint_auth_methods_supported": ["none"],
  "code_challenge_methods_supported": ["S256"]
}
```

`token_endpoint_auth_methods_supported: ["none"]` is what makes Chanakya
register as a public client. `code_challenge_methods_supported: ["S256"]`
satisfies its `SupportsS256PKCE()` check.

Both documents are static apart from the origin, and both are cached at the
edge. Origin comes from `NEXT_PUBLIC_SITE_URL` — never from the request `Host`
header, which is attacker-controllable.

### 7.3 `POST /oauth/register`

RFC 7591. Accepts `redirect_uris` (required, ≥1), `client_name`,
`token_endpoint_auth_method`, `grant_types`, `response_types`, `scope`.

- Reject any non-HTTPS `redirect_uri` except `http://localhost` / `http://127.0.0.1`
  (needed for local MCP clients and local Chanakya dev).
- Issue `client_id` = `cbk_client_` + 16 random bytes base64url.
- `token_endpoint_auth_method: "none"` → public client, no secret returned.
- Rate-limit hard by IP. Open DCR is the one endpoint that is unauthenticated
  *by design*; a registered client can do nothing until a real human completes
  a consent screen, but we still cap row creation.

Returns `201` with `client_id`, `client_id_issued_at`, and the echoed metadata.

### 7.4 `GET /oauth/authorize`

A **page**, not an API route. Requires a live Supabase session.

1. Validate `client_id` exists, `redirect_uri` exact-matches a registered URI,
   `response_type=code`, `code_challenge_method=S256`, `code_challenge` present,
   `resource` equals our MCP URL, and every requested scope is supported.
   **If `redirect_uri` or `client_id` is invalid, render an error page — never
   redirect.** (RFC 6749 §4.1.2.1: an unvalidated redirect target is an open
   redirect.) All other errors redirect back with `error=` + `state`.
2. No session → redirect to `/login?next=<url-encoded original authorize URL>`.
   **This requires adding `?next=` support to the login page, which it does not
   have today** (`src/app/login/page.tsx` only honours `next` on the password-
   reset callback). Validate `next` is a same-origin relative path before using it.
3. Load the profile. No profile, blocked profile, or inactive clinic →
   error page, no code issued. Reuse `evaluateRoleAccess` from
   `src/lib/auth-access.ts` rather than re-deriving.
4. Render the consent screen:
   - who is asking (`client_name`) and what for (scope descriptions in plain
     English — "Read patients and schedule", "Create and change appointments and
     notes", "Record payments and billing entries")
   - which Care-Book account and clinic is being linked
   - scope checkboxes; **`write:billing` unchecked by default and only offered
     to admins**
   - Approve / Deny
5. Approve posts to a server action that issues the code and `302`s to
   `redirect_uri?code=…&state=…`.

CSRF: the consent POST carries a signed, session-bound nonce minted with the
page. A GET must never issue a code.

### 7.5 `POST /oauth/token`

`application/x-www-form-urlencoded`. Two grants.

**`authorization_code`** — look up `code_hash`; reject if missing, expired, or
already consumed; verify `redirect_uri`, `client_id` and `resource` all match
what was stored; verify `base64url(sha256(code_verifier)) == code_challenge`.
Delete the code row and insert the grant in **one transaction**.

**`refresh_token`** — look up `refresh_token_hash`; reject if revoked or
expired; verify `client_id` and `resource`; issue a new access token and a new
refresh token, replacing both digests in one transaction. A replayed old
refresh token finds no row and gets `invalid_grant`.

Errors use RFC 6749 §5.2 codes (`invalid_grant`, `invalid_client`,
`invalid_request`, `unsupported_grant_type`) with `Cache-Control: no-store`.

### 7.6 `POST /oauth/revoke`

RFC 7009. Accepts either token type, sets `revoked_at`, always returns `200`
(the spec forbids leaking whether a token existed).

### 7.7 `POST /api/mcp`

```
initialize              → { protocolVersion: "2024-11-05",
                            capabilities: { tools: {} },
                            serverInfo: { name: "care-book", version: "1.0.0" } }
notifications/initialized → 202, no body
tools/list              → { tools: [...] }   // filtered by grant scopes AND role
tools/call              → { content: [{ type: "text", text: "<json>" }], isError }
anything else           → JSON-RPC -32601
```

`GET /api/mcp` → `401` + the `WWW-Authenticate` challenge from §3.2.

Notes:

- **Tool errors are `isError: true` in a normal result, not JSON-RPC errors.**
  JSON-RPC errors are reserved for protocol faults. Chanakya's `CallTool`
  unmarshals into `ToolCallResult`; a protocol error would look like a broken
  server rather than a failed operation the model can recover from.
- `tools/list` is filtered per grant, so an agent never sees a tool it cannot
  call. A staff grant does not list billing tools at all.
- Error text is sanitised through the same path as migration 037's billing RPC
  sanitisation. Raw Postgres errors must not reach a model context.
- Everything must complete inside Chanakya's 30 s client timeout; every list
  tool has a hard `limit` cap.

---

## 8. Tool catalogue

Naming: `carebook_<verb>_<noun>`. Chanakya namespaces these as
`mcp__care_book__carebook_…` when it registers them.

### 8.1 Scopes

| Scope | Grants |
|---|---|
| `read` | All read tools, subject to the user's own role and RLS |
| `write:clinical` | Patients, appointments, session notes |
| `write:billing` | Payments, packages, refunds, fee adjustments. Admin-only |

A tool is callable only if its scope is in the grant **and** the underlying RLS
or RPC lets that user do it. Both must pass.

### 8.2 Read tools (`read`)

| Tool | Purpose |
|---|---|
| `carebook_whoami` | Linked user, role, clinic, granted scopes. First call an agent should make |
| `carebook_search_patients` | Name/phone search. Reuses `src/lib/schedule/patient-search.ts` |
| `carebook_get_patient` | Demographics, treatment plans, active packages, recent appointments |
| `carebook_list_appointments` | Date range + status + patient filters. Applies `getAppointmentVisibilityFilter` |
| `carebook_get_appointment` | One appointment with its session note |
| `carebook_list_session_notes` | SOAP notes for a patient or appointment |
| `carebook_get_patient_billing` | Packages, payments, balances. Gated on `canViewBilling` |
| `carebook_billing_summary` | Clinic totals over a date range. Admin only |
| `carebook_list_appointment_types` | Configurable types (migration 028) |
| `carebook_list_staff` | Profiles + external staff for assignment |
| `carebook_list_doctors` | Referral sources |

### 8.3 Clinical writes (`write:clinical`)

`carebook_create_patient` · `carebook_update_patient` ·
`carebook_create_appointment` · `carebook_reschedule_appointment` ·
`carebook_cancel_appointment` · `carebook_upsert_session_note`

### 8.4 Billing writes (`write:billing`, admin only)

Each maps 1:1 onto an existing audited RPC. **No tool writes to a billing table
directly** — the RPCs hold the locking, allocation and ledger logic.

| Tool | RPC |
|---|---|
| `carebook_record_payment` | `record_payment_v2` |
| `carebook_record_billing_entry` | `record_billing_entry` |
| `carebook_record_refund` | `record_refund` |
| `carebook_void_payment` | `void_payment` |
| `carebook_cancel_package` | `cancel_package` |
| `carebook_adjust_appointment_fee` | `adjust_appointment_fee` |

Deliberately excluded: `delete_payment`, `delete_package`. Deletion is not
something an agent should reach. Humans do that in the UI.

---

## 9. Write-safety guardrails

The tool surface includes an audited financial ledger. Four layers sit between
a model's intent and a committed row.

**1 — Scope.** `write:billing` is a separate, unchecked-by-default consent
checkbox, offered only to admins. A user can link Care-Book read-only and never
expose billing at all.

**2 — Dry run by default.** Every money-moving tool takes `confirm: boolean`.
Without `confirm: true` it performs full validation and returns a human-readable
preview — "Record ₹2,000 cash payment for Priya Sharma against package
'10-session physio', leaving ₹3,000 outstanding" — and writes nothing,
recording `status: 'dry_run'`. This forces the model to state its intent in a
turn the user can see and interrupt before anything commits.

**3 — Idempotency.** Money tools require an `idempotency_key`. A repeat of a key
already recorded `ok` for that grant returns the stored result instead of
charging twice. Enforced by a partial unique index, so concurrent retries lose
at the database, not in application logic.

**4 — Audit.** Every call writes `mcp_tool_invocations` with tool, args digest,
outcome, and the created entity id. Billing rows already carry
`created_by = auth.uid()`; the invocation row is what says "and it came through
MCP, via this grant, at this time". The digest is a hash — no patient data
lands in the audit table.

Plus per-grant rate limits: 60 reads/min, 10 writes/min, 20 billing writes/hour.

---

## 10. Changes to existing Care-Book code

| File | Change | Why |
|---|---|---|
| `src/middleware.ts` | Add `oauth/token`, `oauth/register`, `oauth/revoke`, `api/mcp`, `.well-known` to the matcher exclusion | These are machine endpoints; the current matcher would redirect them to `/login` |
| `src/middleware.ts` | Leave `/oauth/authorize` **inside** the matcher and **out** of `isPublicRoute`, but make its login redirect carry the return URL | Consent needs a real session; today the redirect drops where the user was going |
| `src/app/login/page.tsx` | Honour `?next=` on successful sign-in, validated as a same-origin relative path | Today `next` only works on the reset callback; without this the consent flow dead-ends on the dashboard |
| `src/lib/security/csp.ts` | Confirm the consent page works under the nonce CSP | New page with a form |
| `src/app/settings/` | New "Connected apps" section: list grants (client name, scopes, last used), revoke button | Users must be able to see and cut the link |
| `src/lib/supabase/types.ts` | Types for the four new tables | Convention |
| `e2e/` | New specs per the CLAUDE.md maintenance policy | New routes + new form + role-gated UI |

Note the matcher currently reads
`['/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons|api/cron).*)']`
— the existing exclusions must be preserved exactly when adding to it.

---

## 11. Testing

| Layer | Command | Covers |
|---|---|---|
| Unit | `npm run test:unit` | Token mint/hash/verify, PKCE S256 verification, JSON-RPC framing, scope resolution, tool input schemas, error sanitisation |
| Integration | `npm run test:integration` | Against real Postgres: a staff grant cannot read billing; an admin grant can; idempotent replay returns the stored result; code redemption is single-use; refresh rotation invalidates the old token; RLS still applies through a minted JWT |
| Component | `npm run test:component` | Consent screen, Connected Apps list |
| E2E | `npm run test:e2e` | Full authorize → consent → callback in a browser; revoke from settings; unauthenticated `/oauth/authorize` redirects to login and returns after sign-in |
| Conformance | new `scripts/mcp-conformance.ts` | Replays Chanakya's exact call sequence — `GET /api/mcp` 401 challenge → discovery → DCR → authorize → token → initialize → tools/list → tools/call — against a local server, with Chanakya's exact headers |

The conformance script matters most. The MoEngage `Accept`-header bug was a
whole extra debugging session; a test that sends byte-identical requests to what
`http_client.go` sends catches that class of failure before deploy.

---

## 12. Configuration

New Care-Book env vars:

| Var | Purpose |
|---|---|
| `SUPABASE_JWT_SECRET` | Mint per-request user JWTs (§5.2). Secret — Vercel encrypted env only |
| `MCP_TOKEN_PEPPER` | Extra input to token hashing so a DB leak alone is not enough |
| `MCP_ENABLED` | Kill switch. Off → `/api/mcp` 404s and discovery documents are not served |

`NEXT_PUBLIC_SITE_URL` already exists and becomes the OAuth `issuer` and the
`resource` value. It must be exact and stable — a mismatch breaks resource
pinning on every refresh.

Nothing to configure on the Chanakya side beyond adding the server row in the
UI. No redeploy, no new env var, no code change.

---

## 13. Phasing

This is too large for one reviewable change. It decomposes into five phases,
each independently shippable and testable. Phases 0–2 are the risky ones; 3–5
are largely mechanical once the identity bridge is proven.

| Phase | Delivers | Done when |
|---|---|---|
| **0. Identity spike** | Answers §5.3: can we mint a Supabase user JWT? | A throwaway script reads a row as a specific user through a minted JWT and RLS demonstrably applies. Outcome recorded; Plan B adopted if it fails |
| **1. Foundations** | Migration 039, token mint/hash/verify, `identity.ts`, JSON-RPC framing, middleware + login `?next=` changes | Unit + integration tests green; no HTTP surface yet |
| **2. OAuth server** | The four `.well-known`/`oauth/*` endpoints and the consent page | Conformance script completes discovery → DCR → authorize → token against a local server |
| **3. MCP endpoint + read tools** | `/api/mcp`, registry, all §8.2 tools | Chanakya connects to a preview deploy and `tools/list` returns the read catalogue |
| **4. Clinical writes** | §8.3 tools, dry-run + idempotency + rate-limit guardrails | Integration tests prove idempotent replay and scope denial |
| **5. Billing writes + Connected Apps UI** | §8.4 tools, settings UI, revoke, e2e specs | Full e2e matrix green; revoke kills a live token |

Phase 3 is the first point at which the integration is genuinely usable, and a
reasonable place to stop and evaluate before opening up writes.

---

## 14. Risks and open questions

| Risk | Mitigation |
|---|---|
| `SUPABASE_JWT_SECRET` unavailable (asymmetric-only project) | Phase 0 spike decides before anything is built; Plan B in §5.3 |
| Open DCR endpoint abused to create client rows | IP rate limit + no capability without a human consent; periodic sweep of clients with zero grants |
| An agent records a wrong payment | Dry-run default, idempotency, admin-only scope, full audit trail, existing RPC guards |
| Vercel cold start pushes a tool past Chanakya's 30 s timeout | Hard `limit` caps, no N+1 queries in tool handlers, measure in the conformance script |
| Token leaks from Chanakya's DB | Tokens are encrypted at rest there (`auth_header_enc`, AES-GCM-V2); 1 h access lifetime; user-visible revoke in Care-Book settings |
| Care-Book's in-flight security review branch conflicts | Build on top of it, not beside it — see §15 |

Open questions for review:

1. **Should `write:billing` be offered at all in the first deploy?** The design
   supports it as requested. Splitting the rollout — ship `read` +
   `write:clinical`, enable `write:billing` a week later once the audit trail
   has been watched — costs nothing, since scope is per-grant.
2. **Multi-clinic users.** The grant pins one `clinic_id` at consent time. If a
   user belongs to more than one clinic, is one grant per clinic right, or
   should the token follow whatever clinic the profile currently points at?
   Current schema suggests one clinic per profile, so pinning is fine — worth
   confirming.
3. **Should `carebook_billing_summary` expose clinic-wide revenue to an LLM
   context at all?** It is admin-visible in the UI already, but MCP output flows
   into a model's context and possibly a third-party API.

---

## 15. Branch and sequencing note

The working tree currently sits on `fix/security-review-2026-08-15` with
uncommitted changes, including a new `src/lib/security/`, three new migrations
(036–038), and middleware edits.

This work touches `src/middleware.ts` and adds migration 039, so it should
**land after** that branch merges, on a fresh branch off the updated `main`.
Starting it as a branch off the security work would tangle two security-relevant
reviews together.

---

## 16. Out of scope

- Chanakya-side changes of any kind.
- MCP resources and prompts (tools only; Chanakya's client calls neither).
- Streamable HTTP sessions, SSE streaming, server-initiated notifications.
- Writing to `delete_payment` / `delete_package`.
- Any second MCP client's onboarding beyond what DCR already gives for free.
