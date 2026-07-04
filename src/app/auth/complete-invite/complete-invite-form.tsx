'use client'

import { useRef, useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
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
  const [fullName, setFullName] = useState('')
  const [mobileNumber, setMobileNumber] = useState('')
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
      fullName,
      mobileNumber,
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
      fullName,
      mobileNumber,
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
          <CardTitle>Complete your account</CardTitle>
          <CardDescription>
            Finish onboarding for <span className="font-medium text-foreground">{email}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="full_name">Name</Label>
              <Input
                id="full_name"
                value={fullName}
                onChange={(event) => {
                  setFullName(event.target.value)
                  clearFieldError('fullName')
                }}
                autoComplete="name"
                aria-invalid={Boolean(fieldErrors.fullName)}
                required
              />
              {fieldErrors.fullName && (
                <p className="text-sm text-destructive">{fieldErrors.fullName}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="mobile_number">Mobile number</Label>
              <Input
                id="mobile_number"
                value={mobileNumber}
                onChange={(event) => {
                  setMobileNumber(event.target.value)
                  clearFieldError('mobileNumber')
                }}
                autoComplete="tel"
                inputMode="tel"
                aria-invalid={Boolean(fieldErrors.mobileNumber)}
                required
              />
              {fieldErrors.mobileNumber && (
                <p className="text-sm text-destructive">{fieldErrors.mobileNumber}</p>
              )}
            </div>
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
                aria-invalid={Boolean(fieldErrors.password)}
                required
              />
              {fieldErrors.password && (
                <p className="text-sm text-destructive">{fieldErrors.password}</p>
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
