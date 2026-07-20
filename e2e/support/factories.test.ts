import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TestInfo } from '@playwright/test'
import { E2EFactory } from './factories.ts'

test('tracked UI row IDs are cleaned in dependency order without touching baseline rows', async () => {
  const deletes: Array<{ table: string; ids: string[] }> = []
  const db = {
    from(table: string) {
      return {
        delete() {
          return {
            async in(_column: string, ids: string[]) {
              deletes.push({ table, ids })
              return { error: null }
            },
          }
        },
      }
    },
  } as unknown as SupabaseClient
  const testInfo = {
    project: { name: 'admin-desktop' },
    workerIndex: 2,
    retry: 0,
  } as unknown as TestInfo
  const factory = new E2EFactory(testInfo, db)

  factory.trackPatient('ui-patient-id')
  factory.trackAppointment('ui-appointment-id')
  factory.trackSessionNote('ui-note-id')
  await factory.cleanup()

  assert.deepEqual(deletes, [
    { table: 'session_notes', ids: ['ui-note-id'] },
    { table: 'appointments', ids: ['ui-appointment-id'] },
    { table: 'patients', ids: ['ui-patient-id'] },
  ])
})
