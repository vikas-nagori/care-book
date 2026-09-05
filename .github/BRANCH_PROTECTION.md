# Branch protection for `main`

The repository workflow runs on every branch push and every pull request. GitHub branch protection
is an external repository setting, so an administrator must configure it after this workflow has
run at least once:

1. Open **Settings → Branches** (or the repository ruleset that targets `main`).
2. Require a pull request before merging.
3. Enable **Require status checks to pass before merging**.
4. Require these workflow job checks from `.github/workflows/test.yml`:
   - `test` — gate over the fast suites: lint + typecheck, unit + component, integration, and
     the production build, which run as separate parallel jobs.
   - `e2e` — the full Playwright role/viewport matrix against isolated local Supabase.
5. Enable **Require branches to be up to date before merging** so both checks run against the
   current `main` tip.

Do not mark only the overall `Tests` workflow as required. Requiring the two job checks prevents a
change from merging when either the fast/build suite or the browser suite is skipped or fails.

## Why `test` and `e2e` are aggregator jobs

The fast suites run as four independent jobs (`lint-typecheck`, `unit-component`, `integration`,
`build`) so they finish side by side instead of one after another. The Playwright suite runs as a
`e2e-shard` matrix across several runners, so its own checks report as `e2e-shard (1)` …
`e2e-shard (n)` — names that change whenever the shard count changes. Neither `test` nor `e2e`
does any testing itself; each depends on its group and fails unless every member succeeded. Keep
requiring only `test` and `e2e`, never the individual jobs or shards: an administrator then never
has to revisit this setting when the suites are regrouped or the shard count is tuned, and a job
that never starts still fails the gate.
