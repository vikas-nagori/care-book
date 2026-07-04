'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { validateClinicOnboardingInput } from '@/lib/onboarding/clinic-onboarding-helpers'
import { createClinicOnboardingRequest } from './actions'

export function ClinicOnboardingForm() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const payload = {
      clinicName: String(formData.get('clinicName') ?? ''),
      ownerFullName: String(formData.get('ownerFullName') ?? ''),
      ownerEmail: String(formData.get('ownerEmail') ?? ''),
      ownerMobileNumber: String(formData.get('ownerMobileNumber') ?? ''),
      clinicPhone: String(formData.get('clinicPhone') ?? ''),
      clinicAddress: String(formData.get('clinicAddress') ?? ''),
    }

    const validation = validateClinicOnboardingInput(payload)
    if (!validation.success) {
      toast({
        title: 'Request not submitted',
        description: validation.message,
        variant: 'destructive',
      })
      return
    }

    setLoading(true)
    const result = await createClinicOnboardingRequest(validation.values)
    setLoading(false)

    if (!result.success) {
      toast({
        title: 'Request not submitted',
        description: result.message,
        variant: 'destructive',
      })
      return
    }

    setSubmitted(true)
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle className="text-center text-2xl">Clinic Onboarding</CardTitle>
      </CardHeader>
      <CardContent>
        {submitted ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              Your request has been submitted for review. If approved, the clinic owner will receive an invite email.
            </p>
            <Button asChild className="w-full">
              <Link href="/login">Back to sign in</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="clinicName">Clinic name</Label>
              <Input id="clinicName" name="clinicName" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ownerFullName">Owner name</Label>
              <Input id="ownerFullName" name="ownerFullName" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ownerEmail">Owner email</Label>
              <Input id="ownerEmail" name="ownerEmail" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ownerMobileNumber">Owner mobile</Label>
              <Input
                id="ownerMobileNumber"
                name="ownerMobileNumber"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                pattern="[0-9]{10}"
                maxLength={10}
                title="Enter a 10 digit mobile number."
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clinicPhone">Clinic phone</Label>
              <Input id="clinicPhone" name="clinicPhone" type="tel" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clinicAddress">Clinic address</Label>
              <Textarea id="clinicAddress" name="clinicAddress" rows={3} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <><Loader2 className="animate-spin" size={14} /> Submitting…</>
              ) : 'Submit Request'}
            </Button>
            <div className="text-center">
              <Link
                href="/login"
                className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
