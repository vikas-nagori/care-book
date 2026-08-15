# Branch protection for `main`

The repository workflow runs on every branch push and every pull request. GitHub branch protection
is an external repository setting, so an administrator must configure it after this workflow has
run at least once:

1. Open **Settings → Branches** (or the repository ruleset that targets `main`).
2. Require a pull request before merging.
3. Enable **Require status checks to pass before merging**.
4. Require these workflow job checks from `.github/workflows/test.yml`:
   - `test` — lint, app + E2E typecheck, unit, component, integration, and production build.
   - `e2e` — the full Playwright role/viewport matrix against isolated local Supabase.
5. Enable **Require branches to be up to date before merging** so both checks run against the
   current `main` tip.

Do not mark only the overall `Tests` workflow as required. Requiring the two job checks prevents a
change from merging when either the fast/build suite or the browser suite is skipped or fails.

## Why `e2e` is a separate job from `e2e-shard`

The Playwright suite runs as a `e2e-shard` matrix across four runners, so its own checks report as
`e2e-shard (1)` … `e2e-shard (4)` — names that change whenever the shard count changes. The `e2e`
job does no testing; it depends on the matrix and fails unless every shard succeeded. Keep
requiring `e2e`, never the individual shards: an administrator then never has to revisit this
setting when the shard count is tuned, and a shard that never starts still fails the gate.
