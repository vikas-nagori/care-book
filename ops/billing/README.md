# Billing impact and historical corrections

These files are deliberately outside `supabase/migrations`. They must not run during a normal
deployment.

Generate the production-pinned, GET-only report with the approved plan:

```sh
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  npm run billing:impact-report -- \
  --plan ops/billing/approved-historical-corrections.plan.json \
  --output /restricted/path/care-book-billing-impact.json
```

The command requires the approved plan, pins project `byhccyhbdnqslqdktybt`, and exits nonzero
when an expected outcome or invariant does not match. The approved 15 August 2026 artifact has:

- source fingerprint: `8cb41a69c363db81ef421f7676a6dc1fc678d436674d25844145abfce9417145`
- plan fingerprint: `ebed6813ce50f371c851c50e265ba0832b2b4daf33ded38d6cd39469ad62a2b8`
- report checksum: `d31a4d6e1114b391d6a722320b27cb2600e15edd0d1a0d81624d7ca0322a26b3`
- file SHA-256: `fd9d4d9d03983cc432b463f64a5b0177dd014b93cdc32801a69955c175c7e93a`

Only after migrations 031-033, a paused billing write window, the second verified backup, and a
fresh byte-for-byte matching report may an operator run:

```sh
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v source_fingerprint=8cb41a69c363db81ef421f7676a6dc1fc678d436674d25844145abfce9417145 \
  -v plan_fingerprint=ebed6813ce50f371c851c50e265ba0832b2b4daf33ded38d6cd39469ad62a2b8 \
  -v report_checksum=d31a4d6e1114b391d6a722320b27cb2600e15edd0d1a0d81624d7ca0322a26b3 \
  -v actor_id=ACTIVE_AMRUTA_ADMIN_UUID \
  -f ops/billing/apply-approved-historical-corrections.sql
```

The script is transactional, exact-row guarded, append-only/audited, and marker-idempotent. Asha
Quartz remains visible in the all-patient report but is intentionally not a correction target.
