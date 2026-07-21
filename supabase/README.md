# Database bootstrap and migrations

`schema.sql` is the base-schema source of truth. The Supabase CLI cannot apply that file before
normal migrations automatically, so `migrations/00000000000000_base_schema.sql` is an exact copy
used to bootstrap an empty local database. A unit test fails if the two files drift.

## Local development

`npm run e2e:db:reset` builds an empty local database by applying the base migration followed by
the numbered incremental migrations. When changing the base schema, make the identical change in
both files and run `npm run test:unit`.

## Existing hosted projects

The base migration is not intended to be replayed on a database that already has the Care Book
tables. Its first statement checks for any core table and aborts before schema DDL, so an accidental
replay fails without partially changing the schema.

Before the first push from this migration history to an existing linked project:

1. Verify that the project's existing `patients`, `appointments`, `treatment_plans`,
   `session_notes`, `packages`, and `payments` tables came from `schema.sql`.
2. Record the bootstrap as already applied:

   ```sh
   supabase migration repair 00000000000000 --status applied --linked
   ```

3. Confirm the local and remote histories with `supabase migration list`, then run the normal
   `supabase db push`.

Do not use `supabase db push --include-all` to force the bootstrap onto an established project.
For a brand-new empty hosted project, the full migration chain may be applied normally.
