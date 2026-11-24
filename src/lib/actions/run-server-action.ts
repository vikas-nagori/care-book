// Framework-free core of callServerAction (see ./call-server-action.ts), kept separate so the
// node test runner can exercise it without Next.js or a browser.

export const STALE_DEPLOYMENT_MESSAGE = 'Care-Book was just updated. Reloading to get the latest version…'
// Worded for writes: the request may have been saved even though no answer came back, so send
// people to check before they repeat it (a repeated payment or booking is worse than a pause).
export const ACTION_UNREACHABLE_MESSAGE =
  "Couldn't get a response from Care-Book. Check your connection, then refresh to see whether it went through before trying again."

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
export type RunServerActionOptions = {
  /** Replaces ACTION_UNREACHABLE_MESSAGE when the caller can say something more specific. */
  failureMessage?: string
}

export async function runServerAction<T>(
  action: () => Promise<T>,
  deps: RunServerActionDeps,
  options: RunServerActionOptions = {},
): Promise<T | ServerActionCallFailure> {
  try {
    return await action()
  } catch (error) {
    deps.rethrowFrameworkError(error)
    if (deps.isStaleDeployment(error)) {
      deps.onFailure('stale')
      // Safe to say: the server rejected the call without running the action.
      deps.onStaleDeployment()
      return { success: false, errorCode: 'CLIENT_STALE_DEPLOYMENT', message: STALE_DEPLOYMENT_MESSAGE }
    }
    deps.onFailure('failed')
    return { success: false, errorCode: 'CLIENT_ACTION_FAILED', message: options.failureMessage ?? ACTION_UNREACHABLE_MESSAGE }
  }
}
