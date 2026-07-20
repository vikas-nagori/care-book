# End-to-End tests (Playwright)

These specs boot the real app against an **isolated local Supabase stack** and drive it as admin
and staff, on desktop and mobile. They exist because unit/component tests never render a full
page — the Billing → Packages crash shipped anyway. Smoke specs load every route; flow specs
exercise real user journeys.

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
  support/                # seed harness, accounts, service-role client, assertions, login helper
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
npm run build:e2e          # production build against the local stack
npm run test:e2e           # runs the suite (webServer serves the build)
npm run test:e2e:report    # open the last HTML report
npm run e2e:db:down        # supabase stop
```

`npm run test:e2e -- --project=admin-desktop` runs a single project.

## Adding specs (keep this current with every feature)

- New route → add it to `shared/smoke.spec.ts` (or a role dir if gated).
- New flow (`*-form.tsx` / `actions.ts`) → add a spec under the role that can perform it.
- Role- or viewport-conditional UI → assert both sides (admin vs staff, desktop vs mobile).
- Reference seeded data via `support/ids.ts` / `support/accounts.ts`; add new fixtures to
  `support/seed.ts` (keep it idempotent — upsert by fixed IDs).
