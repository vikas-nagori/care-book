# End-to-End tests (Playwright)

These specs boot the real app against an **isolated local Supabase stack** and drive it as clinic
admin and staff on desktop and mobile, plus platform and public routes in their supported
viewports. They exist because unit/component tests never render a full page — the Billing →
Packages crash shipped anyway. Route specs verify the exact final location, response, visible
landmark, hydration, page exceptions, and relevant console errors; redirect specs assert their
declared destination instead of treating a redirect target as successful route smoke.

## Prerequisites

- **A Docker-compatible runtime.** `supabase start` needs one. Docker Desktop works; on macOS
  without it, use Colima:
  ```sh
  brew install colima docker
  colima start --cpu 4 --memory 6
  # Colima uses a non-default socket, so point the Supabase CLI at it:
  export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
  ```
- Node 22+ and `npm ci`.
- Port 3000 must be free. Playwright always owns the production E2E server and will not reuse an
  existing process, because that process may have been built against a different Supabase project.

## Layout

```
e2e/
  setup/global.setup.ts   # seeds the DB + logs each role in, saving storageState (runs first)
  pages/                  # focused accessible POMs for patient, appointment, and SOAP forms
  support/                # seed harness, route manifest/guard, nav + route assertions
  shared/                 # specs that run under BOTH admin and staff × desktop and mobile
  admin/  staff/          # role-specific specs
  platform/  public/      # super-admin console / unauthenticated flows
.env.e2e                  # committed local-stack URL + well-known local keys (NOT secret)
```

## Backend & auth model

- The app inlines `NEXT_PUBLIC_*` at build time, so E2E builds with `.env.e2e`
  (`npm run build:e2e`) to point the browser client at the local stack.
- Middleware validates every request with `getUser()`, so sessions can't be faked. The setup
  project seeds real auth users (service-role `admin.createUser`) with a `profiles` row
  (role + active clinic), then signs each in through the real `/login` form and saves cookies as
  Playwright `storageState`. Specs reuse those states.

## Running

```sh
npm run e2e:db:up          # supabase start  (first run pulls images)
npm run e2e:seed           # idempotently restore the fixed local baseline
npm run build:e2e          # production build against the local stack
npm run test:e2e           # starts/validates Supabase, seeds, builds, and runs the suite
npm run test:e2e:report    # open the last HTML report
npm run e2e:db:down        # supabase stop
```

`npm run test:e2e -- --project=admin-desktop` runs a single project.

Stop any existing app on port 3000 before running Playwright. The configured server is always built
with `.env.e2e`; intentionally disabling server reuse prevents mutation specs from driving an
unrelated local app while their service-role verification and cleanup target local Supabase.

`npm run test:e2e:support` includes the route-inventory guard and runs in the normal unit-test/CI
path. `npx playwright test --list` prints the current fully expanded project count, including the
setup/authentication tests.

The normal test command never resets the database. It starts the local stack if necessary and
idempotently restores fixed fixture rows. Use `npm run e2e:db:reset` only when you intentionally
want to discard all local-stack data. `.env.e2e` overrides exported Supabase variables for every
seed/build/server entrypoint, and the seed client additionally rejects non-loopback URLs.

## Page-route matrix

The authoritative declarations live in `support/route-manifest.ts`; role-owned specs consume that
manifest rather than maintaining duplicate route arrays.

| Access group | Viewports | Declared page routes |
| --- | --- | --- |
| Shared clinic admin + staff | desktop + mobile | `/`, `/patients`, `/patients/new`, `/patients/[id]`, `/patients/[id]/edit`, `/schedule`, `/schedule/new`, `/schedule/[id]`, `/settings` |
| Clinic admin | desktop + mobile | `/billing`, all valid `/billing/metrics/[metric]` slugs, `/billing/payment-due/[patientId]` |
| Platform allowlist | desktop only (`platform-desktop`; dependent `platform-signout`) | `/platform`, `/platform/clinics`, `/platform/users`, `/platform/clinic-requests` |
| Public | desktop + mobile | `/login`, `/clinic-onboarding`, plus invalid-session redirects for `/auth/complete-invite` and `/auth/update-password` |

The Billing → Packages real-`timestamptz` regression remains a dedicated admin test. Public desktop
also covers unauthenticated redirects for every protected runtime route, invalid/missing callback
credentials, and unauthorized cron access. The authorized cron branch is intentionally not called:
its date-based update can mutate scheduled appointments, so it is not a deterministic no-op.

Admin desktop and mobile additionally exercise critical write flows. Patient coverage creates a
representative record, searches the list, edits persisted profile fields, and verifies the
deterministic duplicate-phone warning. Schedule coverage creates shared and internally assigned
private appointments, reports an all-or-nothing recurring conflict without inserting any requested
series rows, completes an appointment, creates and edits a SOAP note, and confirms scheduled
appointment deletion. Billing coverage records and allocates a standalone payment, creates a
prepaid package/payment from a seeded template, deletes factory-owned payments and packages,
asserts real records behind billing metric drill-downs, and verifies the seeded unpaid-session
tally. Settings coverage creates/edits/deletes appointment types and package templates, creates
external staff, and exercises unique local user invite → resend → revoke.

Platform desktop management coverage uses only disposable records. It approves and rejects
separate pending clinic requests; verifies the approved clinic, owner invite, and local auth user;
blocks and unblocks a temporary clinic and user while asserting profile and GoTrue ban state;
observes password-reset issuance through the auth user's `recovery_sent_at`; and signs out through
the console before proving `/platform` is no longer accessible. Fixed clinics and seeded accounts
are never selected by these mutation tests. The sign-out spec runs in its own `platform-signout`
project, which depends on `platform-desktop`; this guarantees every shared-session console spec
finishes before the real global sign-out revokes that stored session.

Public flows run independently on desktop and mobile. They submit a representative clinic request,
exercise invalid and valid password login, request recovery from the login form, complete a real
pending business invite, and update a password through a real recovery session. The invite and
recovery setup uses local GoTrue `admin.generateLink`; its returned hashed token is sent through
the application's supported `/auth/callback?token_hash=...&type=...` contract. Tests never scrape
or contact an external mailbox.

Clinic-wide fee mutation is deliberately not covered by a browser write test: `SettingsForm` exists
in `src/app/settings/settings-form.tsx`, but `src/app/settings/page.tsx` neither fetches global
settings nor renders that component, and the responsive desktop/mobile settings views expose no
Session Fees section. The suite does not invent a hidden UI or mutate Clinic A's singleton row in
parallel. Add the flow only when a real rendered settings surface owns it, then serialize or isolate
the singleton mutation and restore the original value in `finally`.

## Navigation and access routing

`support/nav.ts` uses accessible navigation/link roles and verifies the responsive breakpoint:
the Sidebar is visible at `md` and above, while BottomNav is visible below `md`. Both navigate via
the same accessible labels. Admin navigation includes Billing; staff navigation must not contain it.

The access-routing specs separately verify clinic login/platform redirects, the platform account's
redirect away from clinic pages, staff denial for Billing, every valid Billing metric slug, and the
payment-due detail family, plus unauthenticated redirects to `/login`. Expected redirects use
explicit redirect/denial helpers and are never counted as successful page renders.

## Responsive layout matrix

Responsive specs use the configured project viewport and the browser's real
`(min-width: 768px)` media-query result; they do not infer layout from the user agent. Visibility
checks use accessible names and roles, while layout-only contracts use computed styles,
bounding boxes, and document order.

| Surface | Desktop contract | Mobile contract | Roles |
| --- | --- | --- | --- |
| Settings | Persistent account/admin panels; no sheet menu triggers | Semantic section buttons open named bottom sheets, expose `aria-expanded`, close, and restore trigger focus | Admin; staff remains account-only |
| Schedule | Day/week controls, weekly date strip, timeline, and filter sidebar; rolling rail hidden | Named rolling-date region and swipe instruction; selected date centered, native horizontal wheel scrolling, exact date-query navigation, calendar dialog, and filter chips | Admin + staff |
| Dashboard | Header `New appointment`; only the desktop `Up next` instance is visible | Quick-action grid is two columns for admin (`New appt`, `New billing`) and one for staff; `Up next` precedes stats | Admin + staff |
| Patients | `Patient`, `Phone`, and `Joined` table headers with desktop row representation | Compact patient cards with the seeded name, phone, and gender; table headers hidden | Admin + staff |
| Billing | Balance/payment column headers and a two-column package-card grid | Balance/payment compact rows with desktop headers hidden and a one-column package-card grid | Admin only |
| Nested headers | Desktop heading/back controls | Sticky mobile title/back controls on representative new, detail, metric, and payment-due pages | Shared + admin |

The Packages tab intentionally uses one responsive card DOM rather than separate desktop/mobile
duplicates; its contract is the computed two-column versus one-column grid. The schedule gesture
contract is native horizontal overflow scrolling—the UI does not implement a synthetic week-swipe
handler.

## Security coverage matrix

| Security contract | Positive control | Denial / isolation assertion | Viewports |
| --- | --- | --- | --- |
| Billing access | Admin renders `/billing`, all metric families, and seeded payment-due detail | Staff is redirected exactly to `/` from the same direct routes; Billing navigation and dashboard shortcut are absent | desktop + mobile |
| Payment signals | Admin sees the seeded `₹800` dashboard/detail fee, `prepaid` appointment status, dashboard revenue/outstanding tiles, schedule `Day total`/`Expected`, and Asha's Billing tab, package, `₹8,000`, and payment history | Staff sees none of those exact labels, amounts, badges, links, or patient billing sections | desktop + mobile |
| Staff private appointments | Staff can see and open Asha's shared appointment | STAFF cannot see STAFF2's Ravi private appointment on dashboard, schedule, or Ravi history; direct detail renders Next's not-found boundary | desktop + mobile |
| Staff settings | Account Name, Email, Mobile, Role, and Logout remain available | Appointment Types, Package Templates, Invite User, External Staff, Invites, and Active Users are not rendered | desktop + mobile |
| Clinic tenant isolation | Clinic A admin and staff can find Asha and the shared Clinic A appointment | Clinic B patient is absent from list/search and direct detail/edit render not-found; Clinic B appointment is absent from schedule and direct detail renders not-found | admin + staff, desktop + mobile |

Dynamic App Router pages begin streaming the authenticated layout before `notFound()` resolves in
the current Next runtime. The denial helper therefore asserts the observed soft-404 contract
exactly: HTTP 200 document response, no redirect, unchanged requested URL, and the visible
`This page could not be found.` heading. This outcome is kept distinct from successful route smoke.

## Route coverage guard

`support/route-manifest.test.ts` recursively inventories `src/app/**/page.tsx` by filename only and
compares those route patterns with `PAGE_ROUTE_MANIFEST`. Each manifest entry
declares its access group, owning spec, runtime path or expected redirect, and visible landmark.
A new `page.tsx` therefore fails `npm run test:e2e:support` until its route contract and ownership
are declared. The guard intentionally inventories routes; it does not scan page implementation
details.

## Adding specs (keep this current with every feature)

- New page route → declare it once in `support/route-manifest.ts`; the guard identifies omissions.
- New access rule → add it to the appropriate role-owned `access-routing.spec.ts`.
- New flow (`*-form.tsx` / `actions.ts`) → add a spec under the role that can perform it.
- Heavy forms belong in a focused `pages/` object. Prefer labels, roles, names, URLs, responses,
  and polling over CSS/class selectors, DOM timing assumptions, or fixed sleeps.
- Role- or viewport-conditional UI → assert both sides (admin vs staff, desktop vs mobile).
- Reference seeded data via `support/ids.ts` / `support/accounts.ts`; add new fixtures to
  `support/seed.ts` (keep it idempotent — upsert by fixed IDs).
- Mutation specs import `test` and `expect` from `support/factories.ts` and use the injected
  `factory`. Created names are unique across projects/workers/retries, and automatic teardown
  deletes only UUIDs registered by that test. For browser-created rows, register the exact unique
  patient, appointment, payment, package, appointment-type, package-template, external-staff, or
  invite identity *before* clicking submit; teardown discovers and tracks matching UUIDs even after
  a partial browser failure. Invite cleanup also finds and deletes only the auth user with the exact
  unique email. Platform/public factories additionally track exact onboarding-request, clinic,
  profile, and auth-user IDs. For a temporary clinic, teardown discovers only rows carrying that
  exact clinic ID, deletes FK dependents before the profile and clinic, and then deletes only the
  registered auth IDs. Approval watchers use the unique request email/name and invite email to
  recover partially-created clinic/settings/type/invite/auth artifacts. Service-role find helpers
  both verify persistence and track returned mutable rows. Never update or delete fixed `SEED` rows.
