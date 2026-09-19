# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Care-Book

## Commands
- `npm run dev` — Start dev server
- `npm run build` — Production build
- `npm run start` — Run production build locally
- `npm run lint` — ESLint
- `npm run test:unit` — Run all unit tests (Node built-in runner, no Supabase/auth required)
- `npm run test:integration` — Run integration tests against a local Postgres (needs `psql` + a superuser via `PG*` env vars; builds throwaway DBs from `supabase/schema.sql` + migrations). Skips cleanly when no Postgres is reachable.
- `npm run test:component` — Component render tests (vitest + jsdom + testing-library, `src/**/*.component.test.tsx`).
- `npm run typecheck` — `tsc --noEmit` for app + `e2e/` projects.
- `npm run test:e2e` — Playwright E2E against a **local Supabase stack** (needs Docker/Colima). See `e2e/README.md`. First: `npm run e2e:db:up` (`supabase start`) then `npm run build:e2e`, then `npm run test:e2e`.
- Single test file: `node --test --experimental-strip-types src/lib/billing/payment-helpers.test.ts`

## E2E Tests (Playwright)
- Full guide: `e2e/README.md`. Boots the real app against an isolated local Supabase stack and drives it as **admin/staff × desktop/mobile** plus platform/public flows. This is the only layer that catches full-page render crashes (unit/component tests don't render whole routes).
- Auth can't be faked (middleware validates `getUser()`): the Playwright `setup` project seeds real auth users + `profiles` (via service role) and saves `storageState` per role. Backend config lives in `supabase/config.toml`; committed local keys are in `.env.e2e` (non-secret, local-only).
- Schema note: `supabase/migrations/00000000000000_base_schema.sql` mirrors `supabase/schema.sql` so the Supabase CLI migration chain is self-contained; `test/integration/db.ts` skips it. Migration numeric prefixes must be **unique** (the CLI keys migrations by prefix).
- **Maintenance policy (keep tests in lockstep with features):** any PR that adds/changes a `src/app/**/page.tsx` route, a `*-form.tsx`, a `*/actions.ts` mutation, or role-/viewport-gated UI **must** ship a matching `e2e/` spec — new routes → `e2e/shared/routes.spec.ts` (or a role dir if gated); new flows → a spec under the role that can perform it; conditional UI → assert both sides (admin vs staff, desktop vs mobile).

## Branching Policy
**Always do all fixes and development in a new branch.** Never commit code changes directly to `main`. Create a descriptive branch (e.g. `feat/…`, `fix/…`, `chore/…`) before touching any source file.

## CI Monitoring
**Whenever you run `git push`, watch the resulting GitHub Actions run to completion and report pass/fail.** The `Tests` workflow (`.github/workflows/test.yml`) has two required checks, both aggregator jobs: `test` gates the fast suites, which run as four parallel jobs (`lint-typecheck`, `unit-component`, `integration` against a throwaway Postgres, and `build`), and `e2e` gates the full Playwright role/viewport matrix against local Supabase. Both run on every branch push and every pull request. The browser suite itself runs as the `e2e-shard` matrix across six runners, because `playwright.config.ts` pins `workers: 1` (parallel workers on one machine exhaust the Docker socket pool and make GoTrue return 500s); each shard boots Supabase in the background while it installs Chromium and runs `next build`, then serves that build with `E2E_PREBUILT=1`. Report a failure by its job name or shard number; the report artifacts are `playwright-report-shard-<n>`. A newer push to the same ref cancels the in-flight run via the workflow `concurrency` group, so a cancelled conclusion on a superseded commit is expected, not a failure. After pushing, find the run (`gh run list --branch <branch> --limit 1`), wait for it (`gh run watch <id>` or poll `gh run view <id> --json status`), and surface the conclusion — and if it failed, the failing step/log — to the user without being asked. Repository administrators must keep both aggregator checks required for `main`; see `.github/BRANCH_PROTECTION.md`.

## Tech Stack
Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS 3.4 · shadcn/ui (New York style) · Supabase (Postgres + Auth) · `@supabase/ssr` for cookie-based sessions · PWA enabled

## Architecture

### Server/Client Split
- `page.tsx` files are **Server Components** that fetch data via `createClient()` from `src/lib/supabase/server.ts` and pass props to Client Components.
- `*-view.tsx`, `*-list.tsx`, `*-form.tsx` are **Client Components** (`'use client'`) handling interactivity. After mutations they call `router.refresh()`.
- `actions.ts` files use `'use server'` and are the preferred mutation path for admin-guarded writes (billing, settings, invites). They call `requireAdmin()` / `getCurrentProfile()` before touching the DB and call `revalidatePath()` on success.

### Auth & Role-Based Access
- `src/middleware.ts` guards all routes — redirects unauthenticated users to `/login`. Matcher excludes `manifest.json`, `sw.js`, and `/icons` — don't narrow it without preserving those exclusions.
- Two roles: `admin` and `staff`. Use `requireAdmin()` or `requireRole([...])` from `src/lib/auth.ts` in Server Components and actions that need role enforcement (they redirect to `/` on failure).
- `getRestrictedUiAccess(profile)` in `src/lib/access/restricted-visibility.ts` returns a `RestrictedUiAccess` object (`canViewBilling`, `canViewPaymentSignals`, `canViewHomeVisits`, `canUseHomeVisitFormFields`). This is computed once in `RootLayout`, passed into `Sidebar` and `BottomNav`, and threaded as props into any component that conditionally shows admin-only UI (e.g. the Billing tab on patient detail).
- `getAppointmentVisibilityFilter(profile)` in `src/lib/access/appointment-visibility.ts` returns a PostgREST `.or()` filter string for appointment queries. Returns `null` for admins (no filter — sees all), a no-match filter for unauthenticated users, and `type.eq.clinic,created_by.eq.<id>,assigned_to.eq.<id>` for staff. Apply it with `if (filter) query = query.or(filter)` — never skip the null check.

### Supabase Clients
- **Browser**: `src/lib/supabase/client.ts` — `createBrowserClient()` for Client Components
- **Server**: `src/lib/supabase/server.ts` — `createServerClient()` with cookie handlers for RSC/actions/middleware
- **Admin**: `src/lib/supabase/admin.ts` — service-role client for privileged server-side operations (bypasses RLS)

### Database (schema in `supabase/schema.sql` + `supabase/migrations/`)
Core tables: `patients` · `appointments` · `treatment_plans` (FK→patients) · `session_notes` (FK→appointments, SOAP format) · `packages` (FK→patients) · `payments` (FK→patients, optional FK→packages/appointments).

Added by `supabase/migrations/001_payment_appointment_link.sql`:
- `global_settings` — singleton row (id always = 1) for app-wide config (default home/clinic fee).
- `appointment_payments` — many-to-many junction between `payments` and `appointments`. Prefer this for linking a payment to multiple sessions; the direct `payments.appointment_id` FK still exists for legacy one-to-one cases.
- `user_invites` — tracks invite lifecycle (pending → accepted/revoked).

Appointments carry denormalized `payment_status` ('unpaid' | 'prepaid' | 'paid') and a per-session `fee` column so the schedule view renders without joins.

**Billing mutations go through Postgres RPCs** — `record_payment` and `record_billing_entry` — not direct table inserts. These handle the package/payment/appointment linkage atomically.

**Reads that must see a whole period never use an un-ranged `select`.** PostgREST caps one at `max-rows` (1000) and returns the truncated set *without* an error, so totals silently go wrong as data grows. Two rules:
- A screen that needs the individual rows reads them through `fetchAllRows()` (`src/lib/supabase/fetch-all.ts`), which walks `.range()` chunks until a short chunk proves the table is exhausted and **throws** at a hard cap rather than returning a partial set.
- A screen that only displays aggregates aggregates in Postgres instead. `get_billed_month_totals_v1` (migration 043) returns month × appointment-type totals for the billing trend; its optional `p_till_day` restricts every month to its first N days, which is what the "billed till date" comparison uses.

**Manual DB setup**: migration 001 ships a commented-out `cron.schedule` block for auto-completing appointments at 23:59 IST. Requires enabling `pg_cron` in Supabase (Database → Extensions) and running the SQL manually.

### Schedule Calendar
The day-view calendar in `src/app/schedule/schedule-view.tsx` uses absolute positioning. Key constants at the top of the file control the grid:
- `START_HOUR = 7`, `END_HOUR = 22` — visible time range
- `HOUR_HEIGHT = 100` — pixels per hour; changing this scales all chip heights proportionally
- `PX_PER_MIN = HOUR_HEIGHT / 60` — used for `top` and `height` of each chip
- `computeColumns(appts)` — greedy overlap-column assignment; returns `Map<id, { column, totalColumns }>` for side-by-side rendering of simultaneous appointments
- Compact layout threshold: `height < 46` — chips below this show time + name on one row; taller chips show a third line (duration · type · assignee)

### Mobile Layout Conventions
- Desktop: `Sidebar` (`src/components/layout/sidebar.tsx`), visible `md:flex`
- Mobile: `BottomNav` (`src/components/layout/bottom-nav.tsx`), hidden `md:hidden`; page content needs `pb-bottom-nav` (a CSS utility `calc(4rem + env(safe-area-inset-bottom, 0px))`) to clear it
- Detail pages use `MobilePageHeader` (`src/components/layout/mobile-page-header.tsx`) — a sticky `md:hidden` header with back button and optional action slot. Page wrapper must be `px-4 pb-4 md:p-6` (not `p-4`) so the sticky header sits flush to the top. The component uses `-mx-4` to break out of the parent `px-4`.
- Responsive pattern: mobile-first layout in DOM order, `hidden md:block` / `md:hidden` to swap between mobile and desktop variants; never use `display: none` inline styles for responsive hiding.
- Tap targets: icon buttons use Tailwind `min-w-[44px] min-h-[44px]`; buttons with full inline `style={{...}}` objects use `minHeight: 44`.

### Design System
`src/app/globals.css` defines CSS custom properties (`var(--ph-*)`) and utility CSS classes used directly in JSX:
- Color tokens: `--ph-ink`, `--ph-accent`, `--ph-ok`, `--ph-warn`, `--ph-bad`, `--ph-surface`, `--ph-line`, etc.
- Utility classes: `.ph-stat` (stat tiles), `.ph-badge` (status badges with `.ok`/`.warn`/`.bad`/`.info` modifiers), `.ph-appt-chip` (appointment rows), `.ph-patient-row`, `.ph-money`, `.ph-bar` (progress bar), `.ph-nav-link`, `.ph-section-h`
- Use these for new UI that matches existing screens; use shadcn/ui primitives for forms, dialogs, and controls.

### Logging
`src/lib/logger.ts` — structured JSON logger (`logger.info`, `logger.warn`, `logger.error`) that emits to stderr for Vercel log drain. Use it instead of `console.log` for all server-side output.

`redactLogMeta` scrubs sensitive keys before anything reaches the drain. Keys are normalized to snake_case first, so `mobileNumber`, `x-api-key` and `mobile_number` all match the same pattern — add new sensitive names to `SENSITIVE_KEY_PATTERN` in snake_case only. Redaction is a backstop, not a licence: never pass a raw credential object as log metadata (see the catch block in `src/app/auth/complete-invite/actions.ts`).

### Security Headers / CSP
`src/lib/security/csp.ts` is the single source of the Content-Security-Policy.
- **Documents** get their CSP from `src/middleware.ts`, which mints a per-request nonce and sets the policy on *both* the response and the forwarded request headers — Next.js reads it back off the request to stamp the nonce onto its own script tags. `script-src` is `'self' 'nonce-…' 'strict-dynamic'` (plus `'unsafe-eval'` in dev only, for React Refresh). Never add `'unsafe-inline'`.
- **`next.config.mjs`** carries the non-CSP headers on `/:path*`, plus a nonce-less CSP for exactly the paths the middleware matcher excludes (`_next/static`, `sw.js`, `icons`, …). Those two sets must stay **disjoint** — a path matching both gets two CSP headers and the browser enforces the intersection, which blocks the nonced scripts. `src/lib/security/csp.test.ts` asserts this and that the inlined `next.config.mjs` policy still matches the builder.
- Any new inline `<script>` needs the nonce from the `x-nonce` request header. Third-party scripts must be DOM-injected (as Vercel Analytics/Speed Insights are) so `'strict-dynamic'` can vouch for them.

### Date Handling
Use `date-fns` and `date-fns-tz` for all date operations. The app targets IST (Indian Standard Time).

### PWA (hand-rolled, no `next-pwa`)
- Manifest: `public/manifest.json` (standalone, theme `#0f172a`)
- Service worker: `public/sw.js` — network-first, cache `care-book-v1`
- Registered inline in `src/app/layout.tsx` via `<script>`

## Key Paths
- `src/app/` — Pages: `/`, `/patients`, `/schedule`, `/billing`, `/settings` (+ `/[id]`, `/new`, `/edit` segments)
- `src/components/ui/` — shadcn/ui primitives
- `src/components/layout/` — `sidebar.tsx` (desktop), `bottom-nav.tsx` (mobile), `mobile-page-header.tsx`
- `src/lib/access/restricted-visibility.ts` — role→UI feature flags
- `src/lib/access/appointment-visibility.ts` — row-level appointment visibility filter for queries
- `src/lib/auth.ts` — `getCurrentProfile()`, `requireAdmin()`, `requireRole()`
- `src/lib/billing/` — `payment-helpers.ts` (session allocation logic), `unified-billing.ts` (timeline builder)
- `src/lib/schedule/patient-search.ts` — patient filtering/search helpers used by `AppointmentForm`
- `src/lib/supabase/types.ts` — all DB entity TypeScript types
- `src/lib/utils.ts` — `cn()` helper (clsx + tailwind-merge)
- Path alias: `@/*` → `./src/*`

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL` — canonical app origin (production URL); used to build auth email redirect links so they never point to localhost
