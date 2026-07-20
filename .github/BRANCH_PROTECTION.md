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
