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
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "worker-src 'self' blob:",
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co${supabaseConnectSrc}`,
      "manifest-src 'self'",
    ].join('; '),
  },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig;
