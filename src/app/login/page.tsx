'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { BrandLockup } from '@/components/brand/brand'
import { safeReturnPath } from '@/lib/mcp/return-url'
import { getSignInErrorMessage, resolveSignInIdentifier } from '@/lib/auth/sign-in-identifier'

function LoginPageContent() {
  const searchParams = useSearchParams()
  const [view, setView] = useState<'sign-in' | 'reset'>('sign-in')
  // Mobile number is the primary sign-in; email stays available for accounts that have one.
  const [method, setMethod] = useState<'mobile' | 'email'>('mobile')
  const [mobileNumber, setMobileNumber] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const router = useRouter()
  const supabase = createClient()
  const inviteCompleted = searchParams.get('invite') === 'complete'
  const resetCompleted = searchParams.get('reset') === 'complete'
  const authError = searchParams.get('error')
  const nextPath = safeReturnPath(searchParams.get('next'))

  const authErrorMessage =
    authError === 'invite-link-invalid'
      ? 'That invite link is invalid or has expired. Ask an admin to resend it.'
      : authError === 'invite-required'
        ? 'Complete your invite before signing in.'
        : authError === 'reset-link-invalid'
          ? 'That reset link is invalid or has expired. Request a new one.'
          : ''

  const authMessage = inviteCompleted
    ? 'Your account is ready. Sign in with your new password.'
    : resetCompleted
      ? 'Your password has been updated. Sign in with your new password.'
      : ''

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const identifier = resolveSignInIdentifier(method, method === 'mobile' ? mobileNumber : email)
    if (!identifier.ok) {
      setError(identifier.message)
      setLoading(false)
      return
    }

    const { error } = await supabase.auth.signInWithPassword({ ...identifier.credentials, password })
    if (error) {
      setError(getSignInErrorMessage(method, error))
      setLoading(false)
    } else {
      router.replace(nextPath ?? '/')
      router.refresh()
    }
  }

  async function handleResetRequest(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent('/auth/update-password')}`,
    })
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setResetSent(true)
    }
  }

  function switchView(next: 'sign-in' | 'reset') {
    setView(next)
    setError('')
    setResetSent(false)
  }

  function switchMethod(next: 'mobile' | 'email') {
    setMethod(next)
    setError('')
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <BrandLockup
            markSize={48}
            preload
            className="justify-center"
            nameClassName="text-2xl"
          />
        </CardHeader>
        <CardContent>
          {view === 'sign-in' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              {method === 'mobile' ? (
                <div className="space-y-2">
                  <Label htmlFor="mobile-number">Mobile number</Label>
                  <Input
                    id="mobile-number"
                    type="tel"
                    inputMode="tel"
                    // "username" lets iOS/Android password managers save and fill the number.
                    autoComplete="username"
                    placeholder="98765 43210"
                    aria-describedby="mobile-number-hint"
                    value={mobileNumber}
                    onChange={(e) => setMobileNumber(e.target.value)}
                    required
                  />
                  <p id="mobile-number-hint" className="text-xs text-muted-foreground">
                    10 digits, without +91 or 0
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => switchView('reset')}
                    className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
              </div>
              {authMessage && <p className="text-sm text-emerald-700">{authMessage}</p>}
              {authErrorMessage && <p className="text-sm text-destructive">{authErrorMessage}</p>}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => switchMethod(method === 'mobile' ? 'email' : 'mobile')}
                  className="min-h-[44px] text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  {method === 'mobile' ? 'Use email instead' : 'Use mobile number instead'}
                </button>
              </div>
              <div className="text-center">
                <Link
                  href="/clinic-onboarding"
                  className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  Request clinic access
                </Link>
              </div>
            </form>
          ) : (
            <form onSubmit={handleResetRequest} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Sign in with your mobile number? Ask your clinic admin for a new temporary password.
              </p>
              <p className="text-sm text-muted-foreground">
                If your account has an email, enter it and we&apos;ll send you a reset link.
              </p>
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {resetSent && (
                <p className="text-sm text-emerald-700">
                  If an account exists for that email, a reset link has been sent.
                </p>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Link'}
              </Button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => switchView('sign-in')}
                  className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  Back to sign in
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function LoginPageFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <BrandLockup
            markSize={48}
            preload
            className="justify-center"
            nameClassName="text-2xl"
          />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading sign-in form...</p>
        </CardContent>
      </Card>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginPageFallback />}>
      <LoginPageContent />
    </Suspense>
  )
}
