'use client'

import { useRef, useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

type Props = {
  email: string
}

export function UpdatePasswordForm({ email }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const confirmPasswordRef = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (!password) {
      setError('Enter a new password.')
      return
    }

    if (password !== passwordConfirmation) {
      setError('Passwords do not match.')
      confirmPasswordRef.current?.focus()
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>
            Set a new password for <span className="font-medium text-foreground">{email}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password_confirmation">Confirm password</Label>
              <div className="relative">
                <Input
                  id="password_confirmation"
                  ref={confirmPasswordRef}
                  type={showPasswordConfirmation ? 'text' : 'password'}
                  value={passwordConfirmation}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  autoComplete="new-password"
                  className="pr-11"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPasswordConfirmation((value) => !value)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={
                    showPasswordConfirmation ? 'Hide confirm password' : 'Show confirm password'
                  }
                >
                  {showPasswordConfirmation ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <><Loader2 className="animate-spin" size={14} /> Updating password…</>
              ) : 'Update Password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
