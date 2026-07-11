'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { sortAppointmentTypes } from '@/lib/appointments/appointment-type'
import type { AppointmentType } from '@/lib/supabase/types'
import {
  createAppointmentType,
  deleteAppointmentType,
  updateAppointmentType,
} from './actions'

type Props = {
  appointmentTypes: AppointmentType[]
}

const EMPTY = { name: '', sessionRate: '', isShared: 'shared' as 'shared' | 'restricted' }

export function AppointmentTypesList({ appointmentTypes }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const sorted = sortAppointmentTypes(appointmentTypes)

  function startAdd() {
    setEditingId('new')
    setForm(EMPTY)
  }

  function startEdit(type: AppointmentType) {
    setEditingId(type.id)
    setForm({
      name: type.name,
      sessionRate: String(type.session_rate),
      isShared: type.is_shared ? 'shared' : 'restricted',
    })
  }

  function cancel() {
    setEditingId(null)
    setForm(EMPTY)
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    const payload = {
      name: form.name,
      sessionRate: Number(form.sessionRate),
      isShared: form.isShared === 'shared',
    }
    const result =
      editingId && editingId !== 'new'
        ? await updateAppointmentType({ id: editingId, ...payload })
        : await createAppointmentType(payload)
    setSaving(false)

    if (!result.success) {
      toast({ title: 'Type not saved', description: result.message, variant: 'destructive' })
      return
    }

    toast({ title: editingId === 'new' ? 'Appointment type added' : 'Appointment type updated' })
    cancel()
    router.refresh()
  }

  async function handleDelete(type: AppointmentType) {
    setDeletingId(type.id)
    const result = await deleteAppointmentType(type.id)
    setDeletingId(null)

    if (!result.success) {
      toast({ title: 'Type not deleted', description: result.message, variant: 'destructive' })
      return
    }

    toast({ title: 'Appointment type deleted' })
    router.refresh()
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Appointment Types</CardTitle>
        {editingId === null && (
          <Button type="button" variant="outline" size="sm" onClick={startAdd}>
            <Plus size={14} /> Add
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Types shown when booking, each with its own session rate. <strong>Shared</strong> types are
          visible to all staff and need no assignee; <strong>staff-restricted</strong> types are seen
          only by their creator and assignee and require an assignee.
        </p>

        {editingId !== null && (
          <form onSubmit={handleSave} className="space-y-3 rounded-lg border p-3">
            <div className="space-y-2">
              <Label htmlFor="type-name">Name</Label>
              <Input
                id="type-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Clinic"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="type-rate">Session rate (₹)</Label>
                <Input
                  id="type-rate"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={form.sessionRate}
                  onChange={(e) => setForm((f) => ({ ...f, sessionRate: e.target.value }))}
                  placeholder="800"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type-visibility">Visibility</Label>
                <Select
                  value={form.isShared}
                  onValueChange={(value) => setForm((f) => ({ ...f, isShared: value as 'shared' | 'restricted' }))}
                >
                  <SelectTrigger id="type-visibility">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shared">Shared (all staff)</SelectItem>
                    <SelectItem value="restricted">Staff-restricted</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? <><Loader2 className="animate-spin" size={14} /> Saving…</> : 'Save'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={cancel} disabled={saving}>
                <X size={14} /> Cancel
              </Button>
            </div>
          </form>
        )}

        {sorted.length === 0 && editingId === null ? (
          <p className="text-sm text-muted-foreground">No appointment types yet.</p>
        ) : (
          <ul className="divide-y">
            {sorted.map((type) => (
              <li key={type.id} className="flex items-center justify-between gap-2 py-2.5">
                <div>
                  <div className="text-sm font-medium">{type.name}</div>
                  <div className="text-xs text-muted-foreground">
                    ₹{type.session_rate.toLocaleString('en-IN')}/session · {type.is_shared ? 'Shared' : 'Staff-restricted'}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(type)}
                    aria-label={`Edit ${type.name}`}
                    className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(type)}
                    disabled={deletingId === type.id}
                    aria-label={`Delete ${type.name}`}
                    className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                  >
                    {deletingId === type.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
