'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { validateInviteInput } from '@/lib/onboarding/invite-helpers'
import type { UserRole } from '@/lib/supabase/types'
import { createUserInvite } from './actions'

export function InviteForm({ variant = 'card' }: { variant?: 'card' | 'sheet' }) {
  const router = useRouter()
  const { toast } = useToast()
  const instanceId = useId()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [mobileNumber, setMobileNumber] = useState('')
  const [role, setRole] = useState<UserRole>('staff')
  const [loading, setLoading] = useState(false)
  const nameId = `${instanceId}-invite-name`
  const mobileId = `${instanceId}-invite-mobile`
  const emailId = `${instanceId}-invite-email`
  const roleId = `${instanceId}-invite-role`

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const validation = validateInviteInput({ email, role, fullName, mobileNumber })
    if (!validation.success) {
      toast({
        title: 'Invite not sent',
        description: validation.message,
        variant: 'destructive',
      })
      return
    }

    setLoading(true)
    const result = await createUserInvite(validation.values)

    if (!result.success) {
      toast({
        title: 'Invite not sent',
        description: result.message,
        variant: 'destructive',
      })
      setLoading(false)
      return
    }

    toast({
      title: 'Invite sent',
      description: `${result.invite.email} can finish onboarding from the email link.`,
    })
    setEmail('')
    setFullName('')
    setMobileNumber('')
    setRole('staff')
    router.refresh()
    setLoading(false)
  }

  const formContent = (
    <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Asha Patel"
              autoComplete="name"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={mobileId}>Mobile number</Label>
            <Input
              id={mobileId}
              value={mobileNumber}
              onChange={(event) => setMobileNumber(event.target.value)}
              placeholder="9876543210"
              autoComplete="tel"
              inputMode="tel"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={emailId}>Email</Label>
            <Input
              id={emailId}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="staff@example.com"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={roleId}>Role</Label>
            <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
              <SelectTrigger id={roleId}>
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" className={variant === 'sheet' ? 'h-11 w-full' : 'w-full'} disabled={loading}>
            {loading ? (
              <><Loader2 className="animate-spin" size={14} /> Sending invite…</>
            ) : 'Send Invite'}
          </Button>
    </form>
  )

  if (variant === 'sheet') return formContent

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite User</CardTitle>
      </CardHeader>
      <CardContent>
        {formContent}
      </CardContent>
    </Card>
  )
}
