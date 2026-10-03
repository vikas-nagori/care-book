import { isAuthSessionMissingError } from '@supabase/supabase-js'

export function shouldLogAuthError(error: unknown): boolean {
  return error != null && !isAuthSessionMissingError(error)
}
