// Turns an error from a direct Supabase/fetch call into something a user can act on.
//
// supabase-js does not throw when the connection drops; it returns the failure as `error`, so
// screens that show `error.message` were printing "TypeError: Failed to fetch". Pair with
// callServerAction (server actions) so every button ends in a clear message.

export const NETWORK_ERROR_MESSAGE =
  "Couldn't reach Care-Book. Check your connection, then refresh to see whether it went through before trying again."

const NETWORK_MESSAGE = /failed to fetch|load failed|networkerror|network request failed|fetcherror|err_internet_disconnected/i

type ErrorLike = { message?: unknown; name?: unknown; status?: unknown } | null | undefined

export function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { message, name, status } = error as ErrorLike & object
  if (name === 'AuthRetryableFetchError') return true
  if (typeof message === 'string' && NETWORK_MESSAGE.test(message)) return true
  // PostgREST reports a request that never got an HTTP response as status 0.
  return status === 0 && typeof message === 'string' && /error/i.test(message)
}

export function requestErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE
  const message = error && typeof error === 'object' ? (error as ErrorLike)!.message : undefined
  return typeof message === 'string' && message.trim() ? message : fallback
}
