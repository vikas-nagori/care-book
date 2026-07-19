import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { getCurrentProfile } from '@/lib/auth'
import { getRestrictedUiAccess } from '@/lib/access/restricted-visibility'
import { Sidebar } from '@/components/layout/sidebar'
import { BottomNav } from '@/components/layout/bottom-nav'
import { Toaster } from '@/components/ui/toaster'
import { ServiceWorkerRegistration } from '@/components/layout/service-worker-registration'
import { TimezoneSync } from '@/components/layout/timezone-sync'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'

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
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-180.png', sizes: '180x180', type: 'image/png' }],
  },
}

export const viewport: Viewport = {
  themeColor: '#2f5d5a',
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
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} overflow-hidden font-sans`}>
        <TimezoneSync />
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
        <SpeedInsights />
      </body>
    </html>
  )
}
