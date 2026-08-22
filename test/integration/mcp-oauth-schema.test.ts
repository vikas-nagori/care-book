import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDatabase,
  dropDatabase,
  postgresAvailable,
  query,
  queryAsAuthenticated,
  run,
  seedUser,
} from './db.ts'

const DB = 'carebook_it_mcp_oauth_schema'
const hasPostgres = postgresAvailable()
const skip = hasPostgres ? false : 'no local Postgres reachable'

let clinicId = ''
let adminId = ''
let staffId = ''

before(() => {
  if (!hasPostgres) return
  buildDatabase(DB)
  clinicId = query(DB, `insert into clinics (name) values ('MCP Clinic') returning id`)
  adminId = seedUser(DB, 'admin', clinicId)
  staffId = seedUser(DB, 'staff', clinicId)
})

beforeEach(() => {
  if (!hasPostgres) return
  run(
    DB,
    `delete from mcp_resolution_tokens;
     delete from mcp_tool_invocations;
     delete from mcp_authorization_codes;
     delete from mcp_access_grants;
     delete from mcp_oauth_clients;`,
  )
})

after(() => {
  if (hasPostgres) dropDatabase(DB)
})

function seedClient(): string {
  return query(
    DB,
    `insert into mcp_oauth_clients (client_id, client_name, redirect_uris)
     values ('cbk_client_test', 'Chanakya', array['https://example.test/cb'])
     returning client_id`
  )
}

function seedGrant(userId: string, tokenHash: string): string {
  return query(
    DB,
    `insert into mcp_access_grants
       (user_id, clinic_id, client_id, scopes, resource, access_token_hash, access_expires_at)
     values ('${userId}', '${clinicId}', 'cbk_client_test', array['read'],
             'https://example.test/api/mcp', '${tokenHash}', now() + interval '1 hour')
     returning id`
  )
}

test('a public client may not carry a secret hash', { skip }, () => {
  seedClient()
  assert.throws(() =>
    run(
      DB,
      `insert into mcp_oauth_clients (client_id, redirect_uris, token_endpoint_auth_method, client_secret_hash)
       values ('cbk_client_bad', array['https://example.test/cb'], 'none', 'somehash')`
    )
  )
})

test('access token hashes are unique', { skip }, () => {
  seedClient()
  seedGrant(adminId, 'hash-unique-a')
  assert.throws(() => seedGrant(staffId, 'hash-unique-a'))
})

test('a user sees only their own grants under RLS', { skip }, () => {
  seedClient()
  seedGrant(adminId, 'hash-rls-admin')
  seedGrant(staffId, 'hash-rls-staff')
  assert.equal(queryAsAuthenticated(DB, staffId, `select count(*) from mcp_access_grants`), '1')
})

test('idempotency keys are unique per grant among successful calls', { skip }, () => {
  seedClient()
  const grantId = seedGrant(adminId, 'hash-idem')
  const insert = (status: string) =>
    run(
      DB,
      `insert into mcp_tool_invocations
         (grant_id, user_id, clinic_id, tool_name, idempotency_key, request_digest, status)
       values ('${grantId}', '${adminId}', '${clinicId}', 'carebook_record_payment',
               'key-1', 'digest', '${status}')`
    )
  insert('ok')
  assert.throws(() => insert('ok'))
  insert('error')
})

test('refresh grants may remain valid until revoked', { skip }, () => {
  seedClient()
  const grantId = seedGrant(adminId, 'hash-long-lived')
  assert.equal(query(DB, `select refresh_expires_at is null from mcp_access_grants where id = '${grantId}'`), 't')
})
