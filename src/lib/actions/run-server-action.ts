// Framework-free core of callServerAction (see ./call-server-action.ts), kept separate so the
// node test runner can exercise it without Next.js or a browser.

export const STALE_DEPLOYMENT_MESSAGE = 'Care-Book was just updated. Reloading to get the latest version…'
export const ACTION_UNREACHABLE_MESSAGE = "Couldn't reach Care-Book. Check your connection and try again."

export type ServerActionCallFailure = {
  success: false
  errorCode: 'CLIENT_STALE_DEPLOYMENT' | 'CLIENT_ACTION_FAILED'
  message: string
}

export type RunServerActionDeps = {
  /** True when the server did not recognise the action: client and server are different builds. */
  isStaleDeployment: (error: unknown) => boolean
  /** Rethrows Next.js control flow (redirect, notFound) so the router can act on it. */
  rethrowFrameworkError: (error: unknown) => void
  onStaleDeployment: () => void
  onFailure: (kind: 'stale' | 'failed') => void
}

/**
 * Await a server action without ever rejecting. Every Settings action already returns
 * `{ success: false, message }` for failures it knows about; this maps the ones it can't report
 * itself (network loss, a client left on an older deployment) onto the same shape, so callers'
 * existing `if (!result.success)` branch resets their loading state and tells the user.
 */
export async function runServerAction<T>(
  action: () => Promise<T>,
  deps: RunServerActionDeps,
): Promise<T | ServerActionCallFailure> {
  try {
    return await action()
  } catch (error) {
    deps.rethrowFrameworkError(error)
    if (deps.isStaleDeployment(error)) {
      deps.onFailure('stale')
      deps.onStaleDeployment()
      return { success: false, errorCode: 'CLIENT_STALE_DEPLOYMENT', message: STALE_DEPLOYMENT_MESSAGE }
    }
    deps.onFailure('failed')
    return { success: false, errorCode: 'CLIENT_ACTION_FAILED', message: ACTION_UNREACHABLE_MESSAGE }
  }
}
