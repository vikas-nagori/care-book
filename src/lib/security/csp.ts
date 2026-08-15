// Content-Security-Policy construction.
//
// The header used to live entirely in next.config.mjs with
// `script-src 'self' 'unsafe-inline' 'unsafe-eval'`, which meant the CSP offered no XSS
// containment at all — it was the only script-execution control standing behind the app's one
// `dangerouslySetInnerHTML`. Documents now get a per-request nonce from the middleware, so
// inline and injected scripts have to be vouched for rather than blanket-allowed.
//
// `'strict-dynamic'` is what makes this workable with Next.js: the framework stamps the nonce
// onto its own bootstrap and flight scripts, and those in turn load the route chunks and any
// third-party script injected at runtime (Vercel Analytics / Speed Insights both inject via
// the DOM rather than rendering markup). Trust propagates from the nonce, so no host allowlist
// is needed and none is honoured by browsers that understand the keyword.

export type CspOptions = {
  /** Per-request nonce for document responses. Omit for static assets, which run no scripts. */
  nonce?: string
  /** NEXT_PUBLIC_SUPABASE_URL, so a local/self-hosted stack is reachable in connect-src. */
  supabaseUrl?: string | null
  /** React Refresh compiles with eval, so dev — and only dev — needs 'unsafe-eval'. */
  allowUnsafeEval?: boolean
}

/**
 * Allow the app's configured Supabase origin alongside the hosted wildcard, so the CSP tracks
 * NEXT_PUBLIC_SUPABASE_URL (e.g. http://127.0.0.1:54321 for E2E) instead of assuming
 * *.supabase.co.
 */
export function buildConnectSrc(supabaseUrl?: string | null): string {
  const base = "connect-src 'self' https://*.supabase.co wss://*.supabase.co"
  if (!supabaseUrl) return base

  try {
    const { origin, host, protocol } = new URL(supabaseUrl)
    const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'
    return `${base} ${origin} ${wsProtocol}//${host}`
  } catch {
    return base
  }
}

function buildScriptSrc({ nonce, allowUnsafeEval }: CspOptions): string {
  if (!nonce) {
    // Static assets (and the service worker) execute no page scripts of their own.
    return "script-src 'self'"
  }

  const sources = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]
  if (allowUnsafeEval) sources.push("'unsafe-eval'")
  return `script-src ${sources.join(' ')}`
}

export function buildContentSecurityPolicy(options: CspOptions = {}): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Tailwind and Next's font loader emit inline <style>; there is no script execution here
    // and no nonce plumbing for styles in the App Router.
    "style-src 'self' 'unsafe-inline'",
    buildScriptSrc(options),
    "worker-src 'self' blob:",
    buildConnectSrc(options.supabaseUrl),
    "manifest-src 'self'",
  ].join('; ')
}

/** 128 bits of base64 randomness, regenerated for every document response. */
export function createCspNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}
