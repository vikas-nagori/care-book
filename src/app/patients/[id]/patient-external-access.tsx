'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { ExternalProfileOption } from '@/lib/appointments/assignment'
import { savePatientExternalAccess } from '../actions'

export type PatientExternalAccessData = {
  profiles: ExternalProfileOption[]
  grantedProfileIds: string[]
}

export function PatientExternalAccess({
  patientId,
  profiles,
  grantedProfileIds,
}: PatientExternalAccessData & { patientId: string }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [savedProfileIds, setSavedProfileIds] = useState<string[]>(grantedProfileIds)
  const [selected, setSelected] = useState(() => new Set(profiles
    .filter((profile) => grantedProfileIds.includes(profile.id))
    .map((profile) => profile.id)))
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const [status, setStatus] = useState<{ message: string; error?: boolean } | null>(null)
  const searchText = search.trim().toLowerCase()
  const results = profiles.filter((profile) =>
    profile.full_name?.toLowerCase().includes(searchText) || profile.email?.toLowerCase().includes(searchText))
  const saved = new Set(savedProfileIds)
  const hasChanges = saved.size !== selected.size || [...selected].some((id) => !saved.has(id))
  const hasUnavailableGrants = savedProfileIds.some((id) => !profiles.some((profile) => profile.id === id))

  function toggle(profileId: string) {
    setStatus(null)
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(profileId)) next.delete(profileId)
      else next.add(profileId)
      return next
    })
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!hasChanges || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setStatus(null)
    const selectedIds = [...selected]
    try {
      const result = await savePatientExternalAccess(patientId, selectedIds)
      if (!result.success) {
        setStatus({ message: result.message, error: true })
        return
      }
      setSavedProfileIds(selectedIds)
      setStatus({ message: 'Access saved.' })
      router.refresh()
    } catch {
      setStatus({ message: 'Unable to save patient access. Please try again.', error: true })
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>External Staff access</CardTitle>
        <CardDescription>
          Share this patient’s contact details and let selected External Staff book their own appointments. Invited staff can be selected before they first sign in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save}>
          <fieldset disabled={saving} className="min-w-0 space-y-3">
            <legend className="sr-only">Share patient with External Staff</legend>
            {profiles.length > 0 ? (
              <>
                <Input
                  type="search"
                  aria-label="Search External Staff"
                  placeholder="Search by name or email"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {results.length > 0 ? (
                  <div className="max-h-56 divide-y overflow-y-auto rounded-md border">
                    {results.map((profile) => (
                      <label key={profile.id} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-primary"
                          checked={selected.has(profile.id)}
                          onChange={() => toggle(profile.id)}
                        />
                        <span className="min-w-0 break-words">
                          {profile.full_name || profile.email}
                          {profile.full_name && <span className="block text-xs text-muted-foreground">{profile.email}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">No matching accounts.</p>}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No External Staff yet. Add one from Settings → Invite User with the External Staff role, then share this patient here.
              </p>
            )}
            {hasUnavailableGrants && (
              <p className="text-sm text-muted-foreground">Saving removes grants for accounts that are no longer eligible.</p>
            )}
            {(profiles.length > 0 || hasUnavailableGrants) && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span aria-live="polite" className="text-sm text-muted-foreground">{selected.size} selected</span>
                <Button type="submit" disabled={!hasChanges || saving}>{saving ? 'Saving…' : 'Save access'}</Button>
              </div>
            )}
          </fieldset>
          {status && (
            <p role={status.error ? 'alert' : 'status'} className={status.error ? 'mt-3 text-sm text-destructive' : 'mt-3 text-sm'}>
              {status.message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
