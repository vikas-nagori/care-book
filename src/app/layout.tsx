import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { getCurrentProfile } from '@/lib/auth'
import { getRestrictedUiAccess } from '@/lib/access/restricted-visibility'
import { Sidebar } from '@/components/layout/sidebar'
import { BottomNav } from '@/components/layout/bottom-nav'
import { Toaster } from '@/components/ui/toaster'
import { ServiceWorkerRegistration } from '@/components/layout/service-worker-registration'
import { Analytics } from '@vercel/analytics/next'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
})

export const metadata: Metadata = {
  title: 'Care-Book',
  description: 'Physiotherapy Practice Management',
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const currentProfile = await getCurrentProfile()
  const access = getRestrictedUiAccess(currentProfile)

  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} overflow-hidden font-sans`}>
        <div className="flex h-dvh overflow-hidden">
          <Sidebar canViewBilling={access.canViewBilling} />
          <main className="h-full min-w-0 flex-1 overflow-y-auto overscroll-contain pb-bottom-nav md:pb-0">
            {children}
          </main>
        </div>
        <BottomNav canViewBilling={access.canViewBilling} />
        <ServiceWorkerRegistration />
        <Toaster />
        <Analytics />
      </body>
    </html>
  )
}
