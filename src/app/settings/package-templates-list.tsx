'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { calculatePackageTotal } from '@/lib/billing/payment-helpers'
import type { PackageTemplate } from '@/lib/supabase/types'
import {
  createPackageTemplate,
  deletePackageTemplate,
  updatePackageTemplate,
} from './actions'

type Props = {
  templates: PackageTemplate[]
  variant?: 'card' | 'sheet'
}

const EMPTY = { name: '', minSessions: '', perSessionAmount: '' }

export function PackageTemplatesList({ templates, variant = 'card' }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const instanceId = useId()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function startAdd() {
    setEditingId('new')
    setForm(EMPTY)
  }

  function startEdit(template: PackageTemplate) {
    setEditingId(template.id)
    setForm({
      name: template.name,
      minSessions: String(template.min_sessions),
      perSessionAmount: String(template.per_session_amount),
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
      minSessions: Number(form.minSessions),
      perSessionAmount: Number(form.perSessionAmount),
    }
    const result =
      editingId && editingId !== 'new'
        ? await updatePackageTemplate({ id: editingId, ...payload })
        : await createPackageTemplate(payload)
    setSaving(false)

    if (!result.success) {
      toast({ title: 'Template not saved', description: result.message, variant: 'destructive' })
      return
    }

    toast({ title: editingId === 'new' ? 'Template added' : 'Template updated' })
    cancel()
    router.refresh()
  }

  async function handleDelete(template: PackageTemplate) {
    setDeletingId(template.id)
    const result = await deletePackageTemplate(template.id)
    setDeletingId(null)

    if (!result.success) {
      toast({ title: 'Template not deleted', description: result.message, variant: 'destructive' })
      return
    }

    toast({ title: 'Template deleted' })
    router.refresh()
  }

  const previewTotal =
    Number.isFinite(Number(form.minSessions)) && Number.isFinite(Number(form.perSessionAmount))
      ? calculatePackageTotal(Number(form.minSessions) || 0, Number(form.perSessionAmount) || 0)
      : 0

  const nameId = `${instanceId}-template-name`
  const sessionsId = `${instanceId}-template-sessions`
  const rateId = `${instanceId}-template-rate`

  const addButton = editingId === null && (
    <Button
      type="button"
      aria-label="Add package template"
      variant="outline"
      size="sm"
      className={variant === 'sheet' ? 'h-11' : undefined}
      onClick={startAdd}
    >
      <Plus size={14} /> Add
    </Button>
  )

  const content = (
    <>
      <p className="text-sm text-muted-foreground">
        Reusable packages you can pick when creating a billing entry. Selecting one pre-fills the
        name, sessions, and rate — all still editable per patient.
      </p>

      {editingId !== null && (
        <form onSubmit={handleSave} className="space-y-3 rounded-lg border p-3">
          <div className="space-y-2">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              aria-label="Package template name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="10-session package"
              required
            />
          </div>
          <div className={variant === 'sheet'
            ? 'grid grid-cols-1 gap-3 min-[390px]:grid-cols-2'
            : 'grid grid-cols-2 gap-3'}>
            <div className="space-y-2">
              <Label htmlFor={sessionsId}>Minimum sessions</Label>
              <Input
                id={sessionsId}
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={form.minSessions}
                onChange={(e) => setForm((f) => ({ ...f, minSessions: e.target.value }))}
                placeholder="10"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={rateId}>Rate / session (₹)</Label>
              <Input
                id={rateId}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={form.perSessionAmount}
                onChange={(e) => setForm((f) => ({ ...f, perSessionAmount: e.target.value }))}
                placeholder="800"
                required
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Package total: ₹{previewTotal.toLocaleString('en-IN')}
          </p>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              className={variant === 'sheet' ? 'h-11' : undefined}
              disabled={saving}
            >
              {saving ? <><Loader2 className="animate-spin" size={14} /> Saving…</> : 'Save'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={variant === 'sheet' ? 'h-11' : undefined}
              onClick={cancel}
              disabled={saving}
            >
              <X size={14} /> Cancel
            </Button>
          </div>
        </form>
      )}

      {templates.length === 0 && editingId === null ? (
        <p className="text-sm text-muted-foreground">No templates yet.</p>
      ) : (
        <ul className="divide-y">
          {templates.map((template) => (
            <li key={template.id} className="flex items-center justify-between gap-2 py-2.5">
              <div className={variant === 'sheet' ? 'min-w-0' : undefined}>
                <div className={variant === 'sheet' ? 'truncate text-sm font-medium' : 'text-sm font-medium'}>
                  {template.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {template.min_sessions} sessions · ₹{template.per_session_amount.toLocaleString('en-IN')}/session
                  {' · '}₹{calculatePackageTotal(template.min_sessions, template.per_session_amount).toLocaleString('en-IN')} total
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => startEdit(template)}
                  aria-label={`Edit ${template.name}`}
                  className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(template)}
                  disabled={deletingId === template.id}
                  aria-label={`Delete ${template.name}`}
                  className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {deletingId === template.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )

  if (variant === 'sheet') {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">{addButton}</div>
        {content}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Package Templates</CardTitle>
        {addButton}
      </CardHeader>
      <CardContent className="space-y-4">
        {content}
      </CardContent>
    </Card>
  )
}
