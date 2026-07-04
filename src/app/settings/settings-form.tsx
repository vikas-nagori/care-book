'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { updateGlobalSettings } from './actions'
import type { GlobalSettings } from '@/lib/supabase/types'

interface Props {
  settings: GlobalSettings | null
}

export function SettingsForm({ settings }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await updateGlobalSettings({
      homeVisitFee: parseFloat(formData.get('home_visit_fee') as string) || 0,
      clinicFee: parseFloat(formData.get('clinic_fee') as string) || 0,
    })

    if (!result.success) {
      toast({ title: 'Error', description: result.message, variant: 'destructive' })
    } else {
      toast({ title: 'Settings saved' })
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session Fees</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="clinic_fee">Clinic Visit Fee (₹)</Label>
            <Input
              id="clinic_fee"
              name="clinic_fee"
              type="number"
              min="0"
              step="0.01"
              defaultValue={settings?.clinic_fee ?? 0}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="home_visit_fee">Home Visit Fee (₹)</Label>
            <Input
              id="home_visit_fee"
              name="home_visit_fee"
              type="number"
              min="0"
              step="0.01"
              defaultValue={settings?.home_visit_fee ?? 0}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <><Loader2 className="animate-spin" size={14} /> Saving…</>
            ) : 'Save Settings'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
