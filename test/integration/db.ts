// Local-Postgres integration harness. Builds a throwaway database from the Supabase shims +
// supabase/schema.sql + every migration (filename order), so the real production DDL/triggers run
// against a vanilla local Postgres — no Supabase, no Docker. Requires `psql` on PATH (Postgres 14+).
//
// Connection uses standard libpq env vars (PGHOST/PGPORT/PGUSER/PGPASSWORD). The role must be a
// superuser (it creates extensions and roles). On a Homebrew install the default OS user qualifies.

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dirname, '..', '..')
const migrationsDir = join(repoRoot, 'supabase', 'migrations')
const schemaSql = join(repoRoot, 'supabase', 'schema.sql')
const shimSql = join(import.meta.dirname, 'sql', '00_supabase_shims.sql')

// Maintenance DB used only to CREATE/DROP the test DB.
const maintenanceDb = process.env.PGDATABASE_MAINTENANCE ?? 'postgres'

function psql(database: string, args: string[], input?: string): string {
  return execFileSync('psql', ['-d', database, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql') && file !== '00000000000000_base_schema.sql')
    .sort()
    .map((file) => join(migrationsDir, file))
}

function applyFiles(database: string, files: string[]): void {
  for (const file of files) {
    try {
      psql(database, ['-f', file])
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? ''
      throw new Error(`failed applying ${file}:\n${stderr}`)
    }
  }
}

/** True when a local Postgres is reachable, so tests can skip cleanly in environments without one. */
export function postgresAvailable(): boolean {
  try {
    psql(maintenanceDb, ['-c', 'select 1'])
    return true
  } catch {
    return false
  }
}

/** Drop + recreate `dbName` and apply shims, schema.sql, and all migrations in filename order. */
export function buildDatabase(dbName: string): void {
  buildDatabaseThrough(dbName)
}

/** Build through an optional inclusive migration filename for upgrade-path tests. */
export function buildDatabaseThrough(dbName: string, lastMigration?: string): void {
  // Reject anything that isn't a plain identifier — dbName is interpolated into DDL.
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) {
    throw new Error(`unsafe test database name: ${dbName}`)
  }

  const migrations = migrationFiles()
  if (lastMigration && !migrations.some((file) => file.split('/').at(-1) === lastMigration)) {
    throw new Error(`migration anchor not found: ${lastMigration}`)
  }

  psql(maintenanceDb, ['-c', `drop database if exists ${dbName} with (force)`])
  psql(maintenanceDb, ['-c', `create database ${dbName}`])

  const selectedMigrations = lastMigration
    ? migrations.filter((file) => file.split('/').at(-1)! <= lastMigration)
    : migrations
  applyFiles(dbName, [
    shimSql,
    schemaSql,
    ...selectedMigrations,
  ])
}

/** Apply migrations strictly after the supplied filename to an already-built database. */
export function applyMigrationsAfter(dbName: string, migration: string): void {
  const migrations = migrationFiles()
  if (!migrations.some((file) => file.split('/').at(-1) === migration)) {
    throw new Error(`migration anchor not found: ${migration}`)
  }
  applyFiles(dbName, migrations.filter((file) => file.split('/').at(-1)! > migration))
}

export function dropDatabase(dbName: string): void {
  psql(maintenanceDb, ['-c', `drop database if exists ${dbName} with (force)`])
}

/** Run SQL and return stdout. Use `query()` for a single scalar. */
export function run(dbName: string, sql: string): string {
  return psql(dbName, ['-c', sql])
}

/** Run SQL with tuples-only/unaligned output and return the trimmed single-value result. */
export function query(dbName: string, sql: string): string {
  return psql(dbName, ['-t', '-A', '-c', sql]).trim()
}

/**
 * Run SQL within a session whose `auth.uid()` resolves to `userId` (mirrors a logged-in Supabase
 * user). Pass an empty string to run anonymously. Returns the trimmed scalar result of `sql`.
 */
export function queryAs(dbName: string, userId: string, sql: string): string {
  const prefix = userId ? `set request.jwt.claim.sub = '${userId}'; ` : ''
  return query(dbName, prefix + sql)
}

/**
 * Run SQL as the Supabase authenticated role so grants + RLS policies are exercised.
 * Returns the trimmed scalar result of `sql`.
 */
export function queryAsAuthenticated(dbName: string, userId: string, sql: string): string {
  const prefix = [
    `set role authenticated`,
    `set request.jwt.claim.sub = '${userId}'`,
    `set request.jwt.claim.role = 'authenticated'`,
  ].join('; ')
  const suffix = '; reset role'
  return query(dbName, `${prefix}; ${sql}${suffix}`)
}

/** Seed an auth user + profile with the given role and return the user/profile id. */
export function seedUser(
  dbName: string,
  role: 'admin' | 'staff' = 'admin',
  clinicId?: string,
  email?: string
): string {
  const emailSql = email
    ? `'${email}'`
    : `'u' || replace(gen_random_uuid()::text, '-', '') || '@test.local'`
  const id = query(
    dbName,
    `insert into auth.users (email) values (${emailSql}) returning id`
  )
  const clinicSql = clinicId ? `, clinic_id = '${clinicId}'` : ''
  run(dbName, `update public.profiles set role = '${role}'${clinicSql} where id = '${id}'`)
  return id
}
