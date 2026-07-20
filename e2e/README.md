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

`npm run test:e2e:support` includes the route-inventory guard and runs in the normal unit-test/CI
path. `npx playwright test --list` prints the fully expanded project count (currently 125 tests,
including six setup/authentication tests).

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
| Platform allowlist | desktop only | `/platform`, `/platform/clinics`, `/platform/users`, `/platform/clinic-requests` |
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
appointment deletion.

## Navigation and access routing

`support/nav.ts` uses accessible navigation/link roles and verifies the responsive breakpoint:
the Sidebar is visible at `md` and above, while BottomNav is visible below `md`. Both navigate via
the same accessible labels. Admin navigation includes Billing; staff navigation must not contain it.

The access-routing specs separately verify clinic login/platform redirects, the platform account's
redirect away from clinic pages, staff denial for Billing and both dynamic Billing families, and
unauthenticated redirects to `/login`. Expected redirects use explicit redirect/denial helpers and
are never counted as successful page renders.

## Route coverage guard

`support/route-manifest.test.ts` recursively inventories `src/app/**/page.tsx` by filename only and
compares those route patterns with `PAGE_ROUTE_MANIFEST` (20 current pages). Each manifest entry
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
  deletes only UUIDs registered by that test. For browser-created rows, register the exact patient
  name, appointment patient+notes pair, or session-note appointment ID *before* clicking submit;
  teardown discovers and tracks matching UUIDs even after a partial browser failure. Service-role
  find helpers both verify persistence and track returned mutable rows. Never update or delete fixed
  `SEED` rows.
