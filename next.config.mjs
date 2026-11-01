// Allow the app's configured Supabase origin in connect-src. Prod keeps the hosted wildcard;
// this additionally permits a local/self-hosted stack (e.g. http://127.0.0.1:54321 for E2E),
// so the CSP tracks NEXT_PUBLIC_SUPABASE_URL instead of assuming *.supabase.co.
const supabaseConnectSrc = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return ''
  try {
    const { origin, host, protocol } = new URL(url)
    const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'
    return ` ${origin} ${wsProtocol}//${host}`
  } catch {
    return ''
  }
})()

// Documents get their Content-Security-Policy from src/middleware.ts instead, because the
// policy carries a per-request nonce and next.config headers are static. The paths below are
// the ones the middleware matcher deliberately excludes, so without this they would ship no
// CSP at all. They execute no page scripts of their own, hence the nonce-less
// `script-src 'self'`.
//
// The two sets must stay disjoint: a path matching both would receive two CSP headers, and
// browsers enforce the intersection — `'self'` here would then block the nonced scripts there.
//
// This mirrors buildContentSecurityPolicy() in src/lib/security/csp.ts, which next.config.mjs
// cannot import (Node's ESM loader will not resolve a .ts module). src/lib/security/csp.test.ts
// asserts the two stay identical.
const middlewareExcludedPaths = [
  '/_next/static/:path*',
  '/_next/image',
  '/favicon.ico',
  '/manifest.json',
  '/sw.js',
  '/icons/:path*',
  '/api/cron/:path*',
]

const staticAssetCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co${supabaseConnectSrc}`,
  "manifest-src 'self'",
].join('; ')

const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), web-share=(self)',
  },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // PDFKit loads standard fonts through createRequire and package import maps.
  // Webpack's trace finds the ESM variants but misses the CommonJS runtime files.
  outputFileTracingIncludes: {
    '/api/billing/payment-due/*/pdf': ['./node_modules/pdfkit/js/standard-fonts/**/*.cjs'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      ...middlewareExcludedPaths.map((source) => ({
        source,
        headers: [{ key: 'Content-Security-Policy', value: staticAssetCsp }],
      })),
    ]
  },
}

export default nextConfig;
