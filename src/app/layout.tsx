import type { Metadata, Viewport } from 'next'
// Self-hosted (see fonts/fonts.css): the build must never depend on fetching from Google.
import './fonts/fonts.css'
import './globals.css'
import { getCurrentProfile, getSignedInUser } from '@/lib/auth'
import { getRestrictedUiAccess } from '@/lib/access/restricted-visibility'
import { resolveAppNavVariant } from '@/lib/layout/app-chrome'
import { isPlatformAdminEmail } from '@/lib/platform/access'
import { Sidebar } from '@/components/layout/sidebar'
import { BottomNav } from '@/components/layout/bottom-nav'
import { ResumeRefresh } from '@/components/layout/resume-refresh'
import { Toaster } from '@/components/ui/toaster'
import { ServiceWorkerRegistration } from '@/components/layout/service-worker-registration'
import { TimezoneSync } from '@/components/layout/timezone-sync'
import { GuidedTourProvider } from '@/components/tour/guided-tour-provider'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'

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
  const [currentProfile, signedInUser] = await Promise.all([getCurrentProfile(), getSignedInUser()])
  const isExternalStaff = currentProfile?.role === 'external_staff'
  const access = getRestrictedUiAccess(currentProfile)
  // A blocked account (or inactive clinic) reads back no profile; it gets no navigation (G-26).
  const navVariant = resolveAppNavVariant({
    role: currentProfile?.role ?? null,
    signedIn: signedInUser !== null,
    isSuperadmin: isPlatformAdminEmail(signedInUser?.email),
  })

  return (
    <html lang="en">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className="overflow-hidden font-sans">
        <TimezoneSync />
        <div className="flex h-dvh overflow-hidden">
          {navVariant === 'external' && <Sidebar variant="external" />}
          {navVariant === 'clinic' && <Sidebar canViewBilling={access.canViewBilling} />}
          <main className="h-full min-w-0 flex-1 overflow-y-auto overscroll-contain pb-bottom-nav md:pb-0">
            {currentProfile && !isExternalStaff ? (
              <GuidedTourProvider role={currentProfile.role}>{children}</GuidedTourProvider>
            ) : (
              children
            )}
          </main>
        </div>
        {navVariant === 'external' && <BottomNav variant="external" />}
        {navVariant === 'clinic' && <BottomNav canViewBilling={access.canViewBilling} />}
        {currentProfile && <ResumeRefresh />}
        <ServiceWorkerRegistration />
        <Toaster />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
