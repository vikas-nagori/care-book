'use client'

import { unstable_isUnrecognizedActionError, unstable_rethrow } from 'next/navigation'
import { reportClientError } from '@/lib/observability/report-client-error'
import { runServerAction, type RunServerActionOptions, type ServerActionCallFailure } from './run-server-action'

export type { ServerActionCallFailure }

/** Long enough to read the "Care-Book was just updated" toast before the page reloads. */
const STALE_RELOAD_DELAY_MS = 1_500

/**
 * Call a server action from a client component. Never rejects: failures come back as
 * `{ success: false, message }`, like the action's own errors. Every client call must use it
 * (server-action-call-sites.test.ts enforces this) so a dropped request can't leave a button
 * stuck on "Creating…" (incident 2026-11-24).
 *
 *   const result = await callServerAction(() => createUserInvite(values))
 */
export function callServerAction<T>(
  action: () => Promise<T>,
  options?: RunServerActionOptions,
): Promise<T | ServerActionCallFailure> {
  return runServerAction(action, {
    isStaleDeployment: unstable_isUnrecognizedActionError,
    rethrowFrameworkError: unstable_rethrow,
    onStaleDeployment: () => {
      window.setTimeout(() => window.location.reload(), STALE_RELOAD_DELAY_MS)
    },
    onFailure: (kind) => reportClientError(kind === 'stale' ? 'ServerAction/staleClient' : 'ServerAction/failed'),
  }, options)
}
