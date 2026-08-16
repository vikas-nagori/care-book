'use client'

import { useRef, useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { BrandLockup } from '@/components/brand/brand'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  INVITE_PASSWORD_MIN_LENGTH,
  INVITE_PASSWORD_POLICY_MESSAGE,
  getInviteCompletionFieldErrorTarget,
  type InviteCompletionField,
  validateInviteCompletionInput,
} from '@/lib/onboarding/invite-helpers'
import { completeInvitedSignup } from './actions'

type Props = {
  email: string
}

export function CompleteInviteForm({ email }: Props) {
  const router = useRouter()
  const confirmPasswordRef = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<InviteCompletionField, string>>>({})
  const [formError, setFormError] = useState('')

  function clearFieldError(field: InviteCompletionField) {
    setFieldErrors((current) => {
      if (!current[field]) return current

      const nextErrors = { ...current }
      delete nextErrors[field]
      return nextErrors
    })
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    setFieldErrors({})

    const validation = validateInviteCompletionInput({
      password,
      passwordConfirmation,
    })

    if (!validation.success) {
      const targetField = getInviteCompletionFieldErrorTarget(validation.errorCode)

      if (targetField) {
        setFieldErrors({ [targetField]: validation.message })
        if (targetField === 'passwordConfirmation') {
          confirmPasswordRef.current?.focus()
        }
      } else {
        setFormError(validation.message)
      }

      return
    }

    setLoading(true)
    const result = await completeInvitedSignup({
      password,
      passwordConfirmation,
    })

    if (!result.success) {
      const targetField = getInviteCompletionFieldErrorTarget(result.errorCode)

      if (targetField) {
        setFieldErrors({ [targetField]: result.message })
        if (targetField === 'passwordConfirmation') {
          confirmPasswordRef.current?.focus()
        }
      } else {
        setFormError(result.message)
      }

      setLoading(false)
      return
    }

    router.push('/login?invite=complete')
    router.refresh()
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <BrandLockup markSize={36} preload className="mb-3" nameClassName="text-lg" />
          <CardTitle>Complete your account</CardTitle>
          <CardDescription>
            Finish onboarding for <span className="font-medium text-foreground">{email}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  clearFieldError('password')
                }}
                autoComplete="new-password"
                minLength={INVITE_PASSWORD_MIN_LENGTH}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? undefined : 'password_policy'}
                required
              />
              {fieldErrors.password ? (
                <p className="text-sm text-destructive">{fieldErrors.password}</p>
              ) : (
                <p id="password_policy" className="text-xs text-muted-foreground">
                  {INVITE_PASSWORD_POLICY_MESSAGE}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password_confirmation">Confirm password</Label>
              <div className="relative">
                <Input
                  id="password_confirmation"
                  ref={confirmPasswordRef}
                  type={showPasswordConfirmation ? 'text' : 'password'}
                  value={passwordConfirmation}
                  onChange={(event) => {
                    setPasswordConfirmation(event.target.value)
                    clearFieldError('passwordConfirmation')
                  }}
                  autoComplete="new-password"
                  className="pr-11"
                  aria-invalid={Boolean(fieldErrors.passwordConfirmation)}
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
              {fieldErrors.passwordConfirmation && (
                <p className="text-sm text-destructive">{fieldErrors.passwordConfirmation}</p>
              )}
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <><Loader2 className="animate-spin" size={14} /> Saving account…</>
              ) : 'Finish Sign-Up'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
