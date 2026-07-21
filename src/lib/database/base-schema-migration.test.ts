import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const schemaPath = join(root, 'supabase', 'schema.sql')
const baseMigrationPath = join(
  root,
  'supabase',
  'migrations',
  '00000000000000_base_schema.sql'
)

function readSql(path: string) {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n')
}

test('the CLI base migration stays identical to schema.sql', () => {
  assert.equal(readSql(baseMigrationPath), readSql(schemaPath))
})

test('the base schema refuses replay before executing schema DDL', () => {
  const sql = readSql(schemaPath)
  const firstDdl = sql.indexOf('create extension')
  const preamble = sql.slice(0, firstDdl)

  assert.ok(firstDdl > 0, 'expected the UUID extension DDL')
  assert.match(preamble, /if exists[\s\S]+relname in \([\s\S]+patients[\s\S]+payments/)
  assert.match(preamble, /raise exception 'Base schema bootstrap refused:/)
})
