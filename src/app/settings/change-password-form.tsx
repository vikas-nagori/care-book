'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import {
  INVITE_PASSWORD_MIN_LENGTH,
  INVITE_PASSWORD_POLICY_MESSAGE,
  getPasswordChangeFieldErrorTarget,
  type PasswordChangeField,
  validateInviteCompletionInput,
} from '@/lib/onboarding/invite-helpers'
import { changeOwnPassword } from './actions'

export function ChangePasswordForm() {
  const { toast } = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PasswordChangeField, string>>>({})
  const [formError, setFormError] = useState('')

  function clearFieldError(field: PasswordChangeField) {
    setFieldErrors((current) => {
      if (!current[field]) return current

      const nextErrors = { ...current }
      delete nextErrors[field]
      return nextErrors
    })
  }

  function applyError(errorCode: string, message: string) {
    const targetField = getPasswordChangeFieldErrorTarget(errorCode)
    if (targetField) {
      setFieldErrors({ [targetField]: message })
    } else {
      setFormError(message)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    setFieldErrors({})

    if (!currentPassword) {
      setFieldErrors({ currentPassword: 'Enter your current password.' })
      return
    }

    const validation = validateInviteCompletionInput({ password, passwordConfirmation })
    if (!validation.success) {
      applyError(validation.errorCode, validation.message)
      return
    }

    setLoading(true)
    const result = await changeOwnPassword({ currentPassword, password, passwordConfirmation })
    setLoading(false)

    if (!result.success) {
      applyError(result.errorCode, result.message)
      return
    }

    setCurrentPassword('')
    setPassword('')
    setPasswordConfirmation('')
    toast({
      title: 'Password changed',
      description: 'Use your new password the next time you sign in.',
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="current_password">Current password</Label>
        <Input
          id="current_password"
          type="password"
          value={currentPassword}
          onChange={(event) => {
            setCurrentPassword(event.target.value)
            clearFieldError('currentPassword')
          }}
          autoComplete="current-password"
          aria-invalid={Boolean(fieldErrors.currentPassword)}
          required
        />
        {fieldErrors.currentPassword && (
          <p className="text-sm text-destructive">{fieldErrors.currentPassword}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="new_password">New password</Label>
        <Input
          id="new_password"
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            clearFieldError('password')
          }}
          autoComplete="new-password"
          minLength={INVITE_PASSWORD_MIN_LENGTH}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={fieldErrors.password ? undefined : 'new_password_policy'}
          required
        />
        {fieldErrors.password ? (
          <p className="text-sm text-destructive">{fieldErrors.password}</p>
        ) : (
          <p id="new_password_policy" className="text-xs text-muted-foreground">
            {INVITE_PASSWORD_POLICY_MESSAGE}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="new_password_confirmation">Confirm new password</Label>
        <Input
          id="new_password_confirmation"
          type="password"
          value={passwordConfirmation}
          onChange={(event) => {
            setPasswordConfirmation(event.target.value)
            clearFieldError('passwordConfirmation')
          }}
          autoComplete="new-password"
          aria-invalid={Boolean(fieldErrors.passwordConfirmation)}
          required
        />
        {fieldErrors.passwordConfirmation && (
          <p className="text-sm text-destructive">{fieldErrors.passwordConfirmation}</p>
        )}
      </div>
      {formError && <p className="text-sm text-destructive">{formError}</p>}
      <Button type="submit" variant="outline" className="h-11 w-full sm:w-auto" disabled={loading}>
        {loading ? (
          <><Loader2 className="animate-spin" size={14} /> Changing…</>
        ) : 'Change Password'}
      </Button>
    </form>
  )
}
