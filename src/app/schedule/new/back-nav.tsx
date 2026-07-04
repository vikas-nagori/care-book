'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { MobilePageHeader } from '@/components/layout/mobile-page-header'

export function NewAppointmentBackNav({ from }: { from?: string }) {
  const router = useRouter()

  function goBack() {
    if (from) {
      router.push(from)
    } else {
      router.back()
    }
  }

  return (
    <>
      <MobilePageHeader title="New Appointment" onBack={goBack} />
      <div className="hidden md:flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center justify-center min-w-[36px] min-h-[36px] rounded hover:bg-muted"
          aria-label="Go back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-2xl font-bold">New Appointment</h1>
      </div>
    </>
  )
}
