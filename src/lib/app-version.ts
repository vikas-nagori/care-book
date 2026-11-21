/**
 * Which deployment a piece of code came from. The client bundle has its value inlined at build
 * time (NEXT_PUBLIC_APP_VERSION, set in next.config.mjs); the server reads the live deployment's
 * commit at request time. They differ only when the installed app is running an older bundle.
 */
export const CLIENT_APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev'
export const SERVER_APP_VERSION = process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'

/** Only a real, different deployment triggers a reload — never local/dev builds. */
export function isNewerDeployment(clientVersion: string, serverVersion: unknown): boolean {
  return typeof serverVersion === 'string' && serverVersion !== 'dev' && clientVersion !== 'dev'
    && serverVersion.length > 0 && serverVersion !== clientVersion
}

/** Away long enough that the screen may be out of date (others book and edit meanwhile). */
export const RESUME_REFRESH_AFTER_MS = 60_000

export function shouldRefreshOnResume(hiddenAt: number | null, now: number): boolean {
  return hiddenAt !== null && now - hiddenAt >= RESUME_REFRESH_AFTER_MS
}
