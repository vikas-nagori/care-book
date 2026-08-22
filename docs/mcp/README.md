# Care-Book MCP Integration

Everything for exposing Care-Book to Chanakya (and any other MCP client) as a
remote, OAuth-protected MCP server. Three documents, meant to be read in order.

**Status:** implementation is on `feat/carebook-mcp`. The authoritative migration is
`supabase/migrations/040_mcp_oauth.sql`; this README records the least-privilege
contract implemented by the branch.

## Current contract (authoritative)

- MCP reads are limited to account identity, patient details, appointments,
  SOAP session notes, appointment types, staff, and doctors. There are no
  billing-read tools.
- Clinical writes are `carebook_create_patient`, `carebook_create_appointment`,
  `carebook_update_appointment`, `carebook_set_appointment_status` and
  `carebook_delete_appointment` (admin-only, and only while the appointment is
  still scheduled). Edits and deletions preview first and write only on
  `confirm: true`. Session fees are not editable through the clinical tools —
  that stays with the audited billing tools.
- Patient matching is name-based; UUIDs are not public inputs. Matching scores
  trigram similarity in the app (`src/lib/mcp/fuzzy-match.ts`) over the
  RLS-scoped patient list, so shortened names and typos still find the record
  without a Postgres extension. A patient is auto-selected only when the search
  returns exactly one record and the name matches exactly — an exact match never
  suppresses the other candidates it was found alongside. Everything else
  returns masked candidates and opaque, grant-bound selection tokens.
- A new appointment always carries a fee, resolved in this order: the fee passed
  with the request, then **this patient's most recent fee for the same
  appointment type**, then the type's `session_rate`. Rates are negotiated per
  patient, so the type default is the last resort, not the first. When no source
  yields a positive fee the tool returns `requires_fee_confirmation` instead of
  writing, because the ledger coalesces a null fee to a zero-value charge and
  stamps it 'paid'. The resolved fee and where it came from are reported in both
  the preview and the created-appointment result.
- Billing is write-only through six audited RPC-backed tools. They are
  admin-only, unchecked by default at consent, dry-run by default, require
  `confirm: true` and an idempotency key, and never return billing history,
  balances, or package lists.
- Access tokens last one hour. Refresh grants have no fixed expiry, rotate on
  every use, and are revoked when explicitly revoked, or when the linked user
  is blocked, loses clinic access, or is deleted. Resolution tokens expire in
  ten minutes and are single-use when used for a write.

---

## The one-paragraph version

Care-Book becomes a remote MCP server with its own OAuth 2.1 authorization
server layered on Supabase Auth. A Chanakya user links *their own* Care-Book
account through a consent screen, exactly the way a Claude user links a Google
account. The resulting token maps to one `profiles.id`, so every tool call runs
with that person's real role, clinic and permissions. **Chanakya needs no
changes** — it already ships a spec-compliant generic OAuth 2.1 MCP client
(`backend/internal/mcp/oauth/`, migration `000052`), proven against
`mcp.moengage.com` on 2026-07-01.

---

## Reading order

### 1. [`01-design.md`](01-design.md) — the design (~35 KB, 16 sections)

Read this first. The plans are only its execution; the reasoning lives here.

If you read nothing else, read these four:

| Section | Why it matters |
|---|---|
| **§3** The wire contract | Read off Chanakya's actual Go source — protocol version, framing, headers, discovery. This is what makes "zero Chanakya changes" true rather than hopeful. |
| **§5** The identity bridge | The crux. Why service-role access genuinely *cannot* work here, and what replaces it. |
| **§9** Write-safety guardrails | Four independent layers between a model's intent and a committed billing row. |
| **§14** Risks and open questions | Three decisions that are yours, not mine. See below. |

### 2. [`02-plan-oauth-and-reads.md`](02-plan-oauth-and-reads.md) — phases 0–3 (~133 KB, 22 tasks)

Written for an executing agent, with full code and expected output at every
step. **Do not read front to back.** Read the header, Global Constraints, File
Structure, and **Task 0**, then skim task titles.

Task 0 is a ~15-minute throwaway spike that gates everything else — see
"Before writing any code" below.

Delivers, in order: the migration and token primitives → the OAuth endpoints and
consent screen → the MCP endpoint and eleven read tools. **Phase 3 is the first
point where the integration is genuinely usable**, and a sensible place to pause
and evaluate before opening up writes.

### 3. [`03-plan-writes.md`](03-plan-writes.md) — phases 4–5 (~53 KB, 7 tasks)

Clinical writes, then billing writes, then a staged rollout. Its own prerequisite
says not to start until Plan 1 is merged and Chanakya has connected to production
for real.

Worth reading **Task 1** early even so: it extracts the billing validation out of
`src/app/billing/actions.ts` into a module both the web UI and the MCP tools
call, so the two paths cannot drift apart.

---

## Before writing any code

**Plan 1, Task 0** must run first and must pass.

The design mints a short-lived Supabase user JWT per request so RLS applies and
`auth.uid()` is the real person. That needs the project's legacy symmetric
`SUPABASE_JWT_SECRET`. If the Supabase project has migrated to asymmetric
signing keys, that secret does not exist and Tasks 4 and 8 get re-planned around
the documented Plan B (design §5.3).

Do not use the service-role key for user-scoped queries or billing mutations.
Design §5.1 explains why it is not merely weaker but non-functional: `record_payment_v2` gates on
`private.has_role()`, which reads `auth.uid()`, and migration 034 constrains
RPC-origin billing rows to a non-null `created_by`.

---

## Open questions for the owner

Carried from design §14. None block Task 0.

1. **Ship billing writes on day one?** The design supports it as requested.
   Scope is per-grant, so shipping reads plus clinical writes first and enabling
   billing a week later costs nothing and buys a week of watching the audit
   trail.
2. **Multi-clinic users.** The grant pins one `clinic_id` at consent time. The
   current schema suggests one clinic per profile, which makes pinning correct —
   worth confirming.

---

## Verification

The highest-value test in either plan is the conformance script
(Plan 1, Task 19). It replays Chanakya's exact call sequence with its exact
headers against a locally running Care-Book, so a wire-level mismatch surfaces
before deploy rather than after a failed connect. The MoEngage `Accept`-header
bug cost a whole debugging session; this catches that entire class.

```bash
npm run mcp:conformance
```
